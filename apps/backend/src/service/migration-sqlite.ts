import type { VersionContext } from '../dao/object.interface.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { generateSqliteDdl, sqliteIndex, sqliteTable, sqliteView } from './ddl-sqlite.ts'
import {
  ddlOptionsSchema,
  invalidDdl,
  normalizedDesign,
  quoteIdentifier as q,
  scriptResult,
  sqlLiteral,
  type SqlStep,
} from './ddl.ts'
import type { TableDefinition } from './definition.ts'
import { physicalTable, sameValue } from './design-diff.ts'
import { copyColumns, migrationTarget, temporaryName, type MigrationOptions } from './migration.ts'

export const generateSqliteMigration = async (
  context: VersionContext,
  source: DesignObject[],
  input: DesignObject[],
  sql: SqlValidator,
  options: MigrationOptions,
) => {
  if (options.indexesConcurrently || options.constraintsNotValid || options.lockTimeoutMs !== null)
    invalidDdl('SQLite に PostgreSQL 専用の出力オプションは指定できません')
  const sourceDdl = await generateSqliteDdl(context, source, sql, ddlOptionsSchema.parse({}))
  await generateSqliteDdl(context, input, sql, ddlOptionsSchema.parse({}))
  const before = await normalizedDesign(context, source, sql)
  const selection = migrationTarget(
    before,
    await normalizedDesign(context, input, sql),
    'sqlite3',
    options,
  )
  const after = await normalizedDesign(context, selection.objects, sql),
    steps: SqlStep[] = []
  const add = (object: DesignObject | null, statement: string) =>
    steps.push({ objectKey: object?.objectKey ?? null, sql: statement, transactional: true })
  const oldTables = before.filter((v) => v.kind === 'table'),
    newTables = after.filter((v) => v.kind === 'table')
  for (const old of before) {
    const next = after.find((v) => v.objectKey === old.objectKey)
    if (next && next.kind !== old.kind) invalidDdl('同じキーのオブジェクト種別は変更できません')
  }
  const dirty = new Set(
    oldTables
      .filter((old) => {
        const next = newTables.find((v) => v.objectKey === old.objectKey)
        return next && !sameValue(physicalTable(old), physicalTable(next))
      })
      .map((v) => v.objectKey),
  )
  // A rebuilt parent's final name/column names also change the child's stored REFERENCES text.
  let expanded = true
  while (expanded) {
    expanded = false
    for (const table of newTables)
      if (
        !dirty.has(table.objectKey) &&
        oldTables.some((v) => v.objectKey === table.objectKey) &&
        (table.definition as TableDefinition).constraints.some(
          (v) => v.kind === 'foreign_key' && dirty.has(v.referenceTableKey),
        )
      ) {
        dirty.add(table.objectKey)
        expanded = true
      }
  }
  steps.push({
    objectKey: null,
    sql: 'PRAGMA foreign_keys = OFF;',
    transactional: false,
    beforeTransaction: true,
  })
  const changed = selection.difference.changes.length > 0
  if (changed)
    for (const view of before.filter((v) => v.kind === 'view'))
      add(view, `DROP VIEW ${q(view.name)};`)
  const rebuilding = oldTables.filter((v) => dirty.has(v.objectKey))
  for (const table of rebuilding) {
    add(
      table,
      `CREATE TEMP TABLE ${q(temporaryName(table.objectKey, 'data'))} AS SELECT * FROM ${q(table.name)};`,
    )
    if ((table.definition as TableDefinition).columns.some((v) => v.autoincrement))
      add(
        table,
        `CREATE TEMP TABLE ${q(temporaryName(table.objectKey, 'sequence'))} AS SELECT seq FROM sqlite_sequence WHERE name=${sqlLiteral(table.name, 'sqlite3')};`,
      )
  }
  for (const table of oldTables.filter(
    (v) => dirty.has(v.objectKey) || !newTables.some((n) => n.objectKey === v.objectKey),
  ))
    add(table, `DROP TABLE ${q(table.name)};`)
  for (const table of newTables.filter(
    (v) => dirty.has(v.objectKey) || !oldTables.some((n) => n.objectKey === v.objectKey),
  ))
    add(table, sqliteTable(table, after))
  for (const old of rebuilding) {
    const next = newTables.find((v) => v.objectKey === old.objectKey)!,
      copy = copyColumns(old, next)
    add(
      next,
      `INSERT INTO ${q(next.name)} (${copy.columns}) SELECT ${copy.values} FROM ${q(temporaryName(old.objectKey, 'data'))};`,
    )
    add(next, `DROP TABLE ${q(temporaryName(old.objectKey, 'data'))};`)
    if ((old.definition as TableDefinition).columns.some((v) => v.autoincrement)) {
      const temp = q(temporaryName(old.objectKey, 'sequence')),
        tableName = sqlLiteral(next.name, 'sqlite3')
      if ((next.definition as TableDefinition).columns.some((v) => v.autoincrement)) {
        add(
          next,
          `UPDATE sqlite_sequence SET seq=max(seq,COALESCE((SELECT max(seq) FROM ${temp}),0)) WHERE name=${tableName};`,
        )
        add(
          next,
          `INSERT INTO sqlite_sequence(name,seq) SELECT ${tableName},COALESCE((SELECT max(seq) FROM ${temp}),0) WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name=${tableName});`,
        )
      }
      add(next, `DROP TABLE ${temp};`)
    }
  }
  for (const table of newTables.filter(
    (v) => dirty.has(v.objectKey) || !oldTables.some((n) => n.objectKey === v.objectKey),
  ))
    for (const index of (table.definition as TableDefinition).indexes)
      add(table, sqliteIndex(table, index))
  if (changed)
    for (const view of after.filter((v) => v.kind === 'view')) add(view, sqliteView(view))
  // A bare PRAGMA only returns rows. Make violations roll back the transaction instead.
  add(null, 'CREATE TEMP TABLE "_dbcenter_fk_guard" (valid INTEGER CHECK (valid=1));')
  add(
    null,
    'INSERT OR ROLLBACK INTO "_dbcenter_fk_guard" SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END;',
  )
  add(null, 'DROP TABLE "_dbcenter_fk_guard";')
  steps.push({ objectKey: null, sql: 'PRAGMA foreign_keys = ON;', transactional: false })
  const result = scriptResult(context, steps, true, [
    ...selection.warnings,
    ...(dirty.size
      ? [
          '変更するテーブルと参照元を再作成します。新しい型・制約に合わない既存データがあると適用は失敗します。',
        ]
      : []),
  ])
  // Validate against an isolated source schema, never the application's D1 or a live user database.
  await sql.validateDdl(
    'sqlite3',
    [...sourceDdl.steps, ...result.steps].map((v) => v.sql),
  )
  return {
    ...result,
    difference: selection.difference,
    complete: selection.complete,
    recreatedTableKeys: [...dirty].sort(),
    impact: {
      ...selection.difference.impact,
      recreation: selection.difference.impact.recreation || dirty.size > 0,
      outsideTransaction: false,
    },
  }
}
