import type { VersionContext } from '../dao/object.interface.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { generatePostgresDdl, postgresSequence, postgresVersionTable } from './ddl-postgres.ts'
import {
  ddlOptionsSchema,
  invalidDdl,
  normalizedDesign,
  objectName,
  orderedViews,
  quoteIdentifier as q,
  scriptResult,
  sqlLiteral as literal,
  type SqlStep,
} from './ddl.ts'
import type { SequenceDefinition, TableDefinition } from './definition.ts'
import { physicalTable, sameValue } from './design-diff.ts'
import { copyColumns, migrationTarget, temporaryName, type MigrationOptions } from './migration.ts'

export const generatePostgresMigration = async (
  context: VersionContext,
  source: DesignObject[],
  input: DesignObject[],
  sql: SqlValidator,
  options: MigrationOptions,
) => {
  const before = await normalizedDesign(context, source, sql)
  await generatePostgresDdl(context, input, sql, ddlOptionsSchema.parse({}))
  const selection = migrationTarget(
    before,
    await normalizedDesign(context, input, sql),
    'postgresql18',
    options,
  )
  const after = await normalizedDesign(context, selection.objects, sql),
    steps: SqlStep[] = []
  const add = (object: DesignObject | null, statement: string, transactional = true) =>
    steps.push({ objectKey: object?.objectKey ?? null, sql: statement, transactional })
  const name = (v: DesignObject, objects = before) => objectName(v, objects, 'postgresql18')
  const oldTables = before.filter((v) => v.kind === 'table'),
    newTables = after.filter((v) => v.kind === 'table')
  for (const old of before) {
    const next = after.find((v) => v.objectKey === old.objectKey)
    if (next && next.kind !== old.kind) invalidDdl('同じキーのオブジェクト種別は変更できません')
  }
  const shape = (v: DesignObject) => {
    const { name: _name, schemaKey: _schemaKey, columns, ...value } = physicalTable(v)
    return { ...value, columns: columns.map(({ name: _columnName, ...column }) => column) }
  }
  const rebuilt = oldTables.filter((v) => {
    const next = newTables.find((n) => n.objectKey === v.objectKey)
    return next && !sameValue(shape(v), shape(next))
  })
  const removed = oldTables.filter((v) => !newTables.some((n) => n.objectKey === v.objectKey))
  const changed = selection.difference.changes.length > 0
  if (options.lockTimeoutMs !== null) {
    steps.push({
      objectKey: null,
      sql: `SET lock_timeout = ${literal(`${options.lockTimeoutMs}ms`)};`,
      transactional: false,
      beforeTransaction: true,
    })
  }
  // Remove dependent views first. CASCADE is confined to this design; re-create its views and foreign keys below.
  if (changed)
    for (const view of (await orderedViews('postgresql18', before, sql)).reverse())
      add(
        view,
        `DROP ${view.kind === 'materialized_view' ? 'MATERIALIZED VIEW' : 'VIEW'} ${name(view)};`,
      )
  for (const schema of after.filter((v) => v.kind === 'schema'))
    add(schema, `CREATE SCHEMA IF NOT EXISTS ${q(schema.name)};`)
  // Explicit sequences retain their current value even if their owning table is rebuilt.
  for (const sequence of before.filter((v) => v.kind === 'sequence'))
    add(sequence, `ALTER SEQUENCE ${name(sequence)} OWNED BY NONE;`)
  for (const table of rebuilt) {
    add(
      table,
      `CREATE TEMP TABLE ${q(temporaryName(table.objectKey, 'data'))} AS SELECT * FROM ${name(table)};`,
    )
    for (const column of (table.definition as TableDefinition).columns.filter(
      (v) => v.generation?.kind === 'identity',
    )) {
      const temp = q(temporaryName(column.key, 'identity'))
      add(
        table,
        `DO $dbcenter$ DECLARE sequence_name text := pg_get_serial_sequence(${literal(name(table))}, ${literal(column.name)}); BEGIN EXECUTE 'CREATE TEMP TABLE ${temp} AS SELECT last_value, is_called FROM ' || sequence_name; END $dbcenter$;`,
      )
    }
  }
  for (const table of [...rebuilt, ...removed]) add(table, `DROP TABLE ${name(table)} CASCADE;`)
  // Park names before final renames to support swaps and schema moves without collisions.
  const renamed = oldTables.filter(
    (v) =>
      !rebuilt.includes(v) &&
      newTables.some((n) => n.objectKey === v.objectKey && name(n, after) !== name(v)),
  )
  const movedSequences = before.filter(
    (v) =>
      v.kind === 'sequence' &&
      after.some((n) => n.objectKey === v.objectKey && name(n, after) !== name(v)),
  )
  for (const object of [...renamed, ...movedSequences])
    add(
      object,
      `ALTER ${object.kind.toUpperCase()} ${name(object)} RENAME TO ${q(temporaryName(object.objectKey, 'rename'))};`,
    )
  for (const old of [...renamed, ...movedSequences]) {
    const next = after.find((v) => v.objectKey === old.objectKey)!,
      oldSchema = before.find((v) => v.objectKey === old.schemaKey)!,
      schema = after.find((v) => v.objectKey === next.schemaKey)!
    const parked = q(temporaryName(old.objectKey, 'rename'))
    if (oldSchema.name !== schema.name)
      add(
        old,
        `ALTER ${old.kind.toUpperCase()} ${q(oldSchema.name)}.${parked} SET SCHEMA ${q(schema.name)};`,
      )
    add(
      next,
      `ALTER ${old.kind.toUpperCase()} ${q(schema.name)}.${parked} RENAME TO ${q(next.name)};`,
    )
  }
  for (const old of oldTables.filter((v) => !rebuilt.includes(v))) {
    const next = newTables.find((v) => v.objectKey === old.objectKey)
    if (!next) continue
    const columns = (old.definition as TableDefinition).columns.filter((v) =>
      (next.definition as TableDefinition).columns.some(
        (c) => c.key === v.key && c.name !== v.name,
      ),
    )
    for (const column of columns)
      add(
        next,
        `ALTER TABLE ${name(next, after)} RENAME COLUMN ${q(column.name)} TO ${q(temporaryName(column.key, 'column'))};`,
      )
    for (const column of columns)
      add(
        next,
        `ALTER TABLE ${name(next, after)} RENAME COLUMN ${q(temporaryName(column.key, 'column'))} TO ${q((next.definition as TableDefinition).columns.find((v) => v.key === column.key)!.name)};`,
      )
  }
  for (const sequence of before.filter(
    (v) => v.kind === 'sequence' && !after.some((n) => n.objectKey === v.objectKey),
  ))
    add(sequence, `DROP SEQUENCE ${name(sequence)};`)
  for (const sequence of after.filter(
    (v) => v.kind === 'sequence' && before.some((n) => n.objectKey === v.objectKey),
  ))
    add(
      sequence,
      `ALTER SEQUENCE ${name(sequence, after)} ${postgresSequence(sequence.definition as SequenceDefinition)};`,
    )
  const output = after.map((v) => {
    if (v.kind !== 'table') return v
    const table = v.definition as TableDefinition
    return {
      ...v,
      definition: {
        ...table,
        indexes: table.indexes.map((index) => ({
          ...index,
          concurrently: options.indexesConcurrently || index.concurrently,
        })),
        constraints: table.constraints.map((constraint) =>
          options.constraintsNotValid &&
          (constraint.kind === 'check' || constraint.kind === 'foreign_key')
            ? { ...constraint, notValid: true }
            : constraint,
        ),
      },
    }
  })
  const compiled = await generatePostgresDdl(
    context,
    output,
    sql,
    ddlOptionsSchema.parse({ ifNotExists: true }),
  )
  const tablesToCopy = new Map(rebuilt.map((v) => [v.objectKey, v]))
  for (const step of compiled.steps.filter((v) => v.transactional && v.phase !== 'constraint')) {
    if (!changed && /^(?:SET LOCAL search_path|DO \$dbcenter\$)/.test(step.sql)) continue
    steps.push(step)
    const old = step.objectKey ? tablesToCopy.get(step.objectKey) : undefined
    if (!old || !step.sql.startsWith('CREATE TABLE')) continue
    const next = newTables.find((v) => v.objectKey === old.objectKey)!,
      copy = copyColumns(old, next)
    add(
      next,
      `INSERT INTO ${name(next, after)} (${copy.columns}) OVERRIDING SYSTEM VALUE SELECT ${copy.values} FROM ${q(temporaryName(old.objectKey, 'data'))};`,
    )
    add(next, `DROP TABLE ${q(temporaryName(old.objectKey, 'data'))};`)
    for (const column of (old.definition as TableDefinition).columns.filter(
      (v) => v.generation?.kind === 'identity',
    )) {
      const target = (next.definition as TableDefinition).columns.find(
        (v) => v.key === column.key && v.generation?.kind === 'identity',
      )
      const temp = q(temporaryName(column.key, 'identity'))
      if (target)
        add(
          next,
          `SELECT setval(pg_get_serial_sequence(${literal(name(next, after))}, ${literal(target.name)}), GREATEST((SELECT last_value FROM ${temp}), COALESCE((SELECT max(${q(target.name)}) FROM ${name(next, after)}), 1)), (SELECT is_called FROM ${temp}) OR EXISTS (SELECT 1 FROM ${name(next, after)}));`,
        )
      add(next, `DROP TABLE ${temp};`)
    }
  }
  steps.push(
    ...compiled.steps.filter((v) => v.transactional && v.phase === 'constraint'),
    ...compiled.steps.filter((v) => !v.transactional),
  )
  if (options.constraintsNotValid)
    for (const table of newTables)
      for (const constraint of (table.definition as TableDefinition).constraints) {
        if (
          (constraint.kind !== 'check' && constraint.kind !== 'foreign_key') ||
          constraint.notValid
        )
          continue
        const outside = steps.some(
          (v) => !v.transactional && v.phase === 'constraint' && v.objectKey === table.objectKey,
        )
        add(
          table,
          `ALTER TABLE ${name(table, after)} VALIDATE CONSTRAINT ${q(constraint.name)};`,
          !outside,
        )
      }
  if (options.includeDrops)
    for (const schema of before.filter(
      (v) => v.kind === 'schema' && !after.some((n) => n.kind === 'schema' && n.name === v.name),
    ))
      add(schema, `DROP SCHEMA ${q(schema.name)};`)
  if (selection.complete && changed) {
    const statement = (await postgresVersionTable(context, after))[2]!
    add(
      null,
      `DO $dbcenter$ BEGIN IF to_regclass('"_dbcenter"."version"') IS NOT NULL THEN EXECUTE ${literal(statement)}; END IF; END $dbcenter$;`,
      !steps.some((v) => !v.transactional && !v.beforeTransaction),
    )
  }
  if (options.lockTimeoutMs !== null) add(null, 'RESET lock_timeout;', false)
  const result = scriptResult(context, steps, true, [
    ...selection.warnings,
    ...(rebuilt.length
      ? [
          '構造を変更するテーブルは一時表へ退避して再作成します。新しい型・制約に合わない既存データがあると適用は失敗します。',
        ]
      : []),
  ])
  await sql.validateDdl(
    'postgresql18',
    result.steps.map((v) => v.sql),
  )
  return {
    ...result,
    difference: selection.difference,
    complete: selection.complete,
    recreatedTableKeys: rebuilt.map((v) => v.objectKey),
    impact: {
      ...selection.difference.impact,
      recreation: selection.difference.impact.recreation || rebuilt.length > 0,
      outsideTransaction: steps.some(
        (v) => !v.transactional && !v.beforeTransaction && v.sql !== 'RESET lock_timeout;',
      ),
    },
  }
}
