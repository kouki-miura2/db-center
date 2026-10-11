import type { VersionContext } from '../dao/object.interface.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import {
  invalidDdl,
  normalizedDesign,
  objectName,
  orderedViews,
  qualifiedIdentifier,
  quoteIdentifier as q,
  scriptResult,
  selectSql,
  sqlLiteral as literal,
  tableColumns,
  type DdlOptions,
  type SqlStep,
} from './ddl.ts'
import type {
  DesignColumn,
  SequenceDefinition,
  TableDefinition,
  ViewDefinition,
} from './definition.ts'

export const postgresColumn = (column: DesignColumn) => {
  const clauses = [q(column.name), column.dataType]
  if (column.storage) clauses.push(`STORAGE ${column.storage}`)
  if (column.compression) clauses.push(`COMPRESSION ${column.compression}`)
  if (column.collation) clauses.push(`COLLATE ${qualifiedIdentifier(column.collation)}`)
  if (column.generation?.kind === 'identity')
    clauses.push(`GENERATED ${column.generation.always ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY`)
  if (column.generation?.kind === 'generated')
    clauses.push(
      `GENERATED ALWAYS AS (${column.generation.expression}) ${column.generation.stored ? 'STORED' : 'VIRTUAL'}`,
    )
  if (column.defaultValue !== null) clauses.push(`DEFAULT (${column.defaultValue})`)
  if (column.notNull) clauses.push('NOT NULL')
  return clauses.join(' ')
}
export const postgresConstraint = (
  constraint: TableDefinition['constraints'][number],
  table: TableDefinition,
  objects: DesignObject[],
) => {
  const prefix = `CONSTRAINT ${q(constraint.name)}`
  const defer =
    'deferrable' in constraint && constraint.deferrable
      ? ` DEFERRABLE INITIALLY ${constraint.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}`
      : ''
  if (constraint.kind === 'primary_key')
    return `${prefix} PRIMARY KEY (${tableColumns(table, constraint.columns)})`
  if (constraint.kind === 'unique')
    return `${prefix} UNIQUE${constraint.nullsDistinct ? '' : ' NULLS NOT DISTINCT'} (${tableColumns(table, constraint.columns)})${defer}`
  if (constraint.kind === 'check')
    return `${prefix} CHECK (${constraint.expression})${constraint.notValid ? ' NOT VALID' : ''}`
  const target = objects.find(
    (v) => v.kind === 'table' && v.objectKey === constraint.referenceTableKey,
  )
  if (!target) return invalidDdl('外部キーの参照先がありません')
  return `${prefix} FOREIGN KEY (${tableColumns(table, constraint.columns)}) REFERENCES ${objectName(target, objects, 'postgresql18')} (${tableColumns(target.definition as TableDefinition, constraint.referenceColumns)}) MATCH ${constraint.match} ON UPDATE ${constraint.onUpdate} ON DELETE ${constraint.onDelete}${defer}${constraint.notValid ? ' NOT VALID' : ''}`
}
export const postgresIndex = (
  object: DesignObject,
  index: TableDefinition['indexes'][number],
  objects: DesignObject[],
  ifNotExists = false,
  concurrently = index.concurrently,
) => {
  const table = object.definition as TableDefinition
  const columns = index.columns
    .map(
      (v) =>
        `${v.columnKey ? tableColumns(table, [v.columnKey]) : `(${v.expression})`} ${v.order}${v.nulls ? ` NULLS ${v.nulls}` : ''}`,
    )
    .join(', ')
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${concurrently ? 'CONCURRENTLY ' : ''}${ifNotExists ? 'IF NOT EXISTS ' : ''}${q(index.name)} ON ${objectName(object, objects, 'postgresql18')} USING ${index.method} (${columns})${index.include.length ? ` INCLUDE (${tableColumns(table, index.include)})` : ''}${index.fillfactor !== null ? ` WITH (fillfactor = ${index.fillfactor})` : ''}${index.where ? ` WHERE (${index.where})` : ''};`
}
export const postgresSequence = (value: SequenceDefinition) =>
  `AS ${value.dataType} INCREMENT BY ${value.increment} ${value.min === null ? 'NO MINVALUE' : `MINVALUE ${value.min}`} ${value.max === null ? 'NO MAXVALUE' : `MAXVALUE ${value.max}`} START WITH ${value.start} CACHE ${value.cache} ${value.cycle ? 'CYCLE' : 'NO CYCLE'}`
export const postgresView = (
  object: DesignObject,
  objects: DesignObject[],
  ifNotExists = false,
) => {
  const value = object.definition as ViewDefinition,
    materialized = object.kind === 'materialized_view'
  if (
    materialized &&
    (value.options.securityInvoker !== undefined ||
      value.options.securityBarrier !== undefined ||
      value.options.checkOption)
  )
    invalidDdl('マテリアライズドビューにビュー専用オプションは指定できません')
  if (!materialized && value.options.withData !== undefined)
    invalidDdl('WITH DATA はマテリアライズドビューだけに指定できます')
  const options = [
    ...(value.options.securityInvoker !== undefined
      ? [`security_invoker = ${value.options.securityInvoker}`]
      : []),
    ...(value.options.securityBarrier !== undefined
      ? [`security_barrier = ${value.options.securityBarrier}`]
      : []),
  ]
  const body = `CREATE ${materialized ? 'MATERIALIZED ' : ''}VIEW ${ifNotExists && materialized ? 'IF NOT EXISTS ' : ''}${objectName(object, objects, 'postgresql18')}${options.length ? ` WITH (${options.join(', ')})` : ''} AS\n${selectSql(value.select)}\n${materialized ? (value.options.withData === false ? 'WITH NO DATA' : 'WITH DATA') : value.options.checkOption ? `WITH ${value.options.checkOption} CHECK OPTION` : ''};`
  if (!ifNotExists || materialized) return body
  const schema = objects.find((v) => v.kind === 'schema' && v.objectKey === object.schemaKey)!
  return `DO $dbcenter$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${literal(schema.name)} AND c.relname=${literal(object.name)}) THEN EXECUTE ${literal(body)}; END IF; END $dbcenter$;`
}
export const postgresComments = (object: DesignObject, objects: DesignObject[]) => {
  const statements: string[] = [],
    name = objectName(object, objects, 'postgresql18'),
    value = object.definition as { comment?: string | null }
  const kind = object.kind === 'materialized_view' ? 'MATERIALIZED VIEW' : object.kind.toUpperCase()
  statements.push(
    `COMMENT ON ${kind} ${name} IS ${value.comment === undefined || value.comment === null ? 'NULL' : literal(value.comment)};`,
  )
  if (object.kind === 'table')
    for (const column of (object.definition as TableDefinition).columns)
      statements.push(
        `COMMENT ON COLUMN ${name}.${q(column.name)} IS ${column.comment === null ? 'NULL' : literal(column.comment)};`,
      )
  return statements
}
export const postgresVersionTable = (context: VersionContext) => [
  'CREATE SCHEMA IF NOT EXISTS "_dbcenter";',
  'CREATE TABLE IF NOT EXISTS "_dbcenter"."version" (singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton), database_id text NOT NULL, version_id text NOT NULL, version_number integer NOT NULL, applied_at timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP);',
  `INSERT INTO "_dbcenter"."version" (singleton,database_id,version_id,version_number) VALUES (true,${literal(context.version.databaseId)},${literal(context.version.id)},${context.version.number}) ON CONFLICT (singleton) DO UPDATE SET database_id=EXCLUDED.database_id,version_id=EXCLUDED.version_id,version_number=EXCLUDED.version_number,applied_at=CURRENT_TIMESTAMP;`,
]
export const generatePostgresDdl = async (
  context: VersionContext,
  input: DesignObject[],
  sql: SqlValidator,
  options: DdlOptions,
) => {
  const objects = await normalizedDesign(context, input, sql),
    steps: SqlStep[] = []
  const add = (object: DesignObject | null, statement: string, transactional = true) =>
    steps.push({ objectKey: object?.objectKey ?? null, sql: statement, transactional })
  const schemas = objects
    .filter((v) => v.kind === 'schema')
    .toSorted((a, b) => a.name.localeCompare(b.name))
  if (options.versionTable && schemas.some((v) => v.name === '_dbcenter'))
    invalidDdl('_dbcenter はバージョン管理用です')
  const tables = objects
    .filter((v) => v.kind === 'table')
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const sequences = objects
    .filter((v) => v.kind === 'sequence')
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const views = await orderedViews('postgresql18', objects, sql)
  if (options.dropExisting)
    for (const object of [...views].reverse().concat(tables, sequences))
      add(
        object,
        `DROP ${object.kind === 'materialized_view' ? 'MATERIALIZED VIEW' : object.kind.toUpperCase()} IF EXISTS ${objectName(object, objects, 'postgresql18')} CASCADE;`,
      )
  if (options.includeSchemas)
    for (const object of schemas) {
      const owner = (object.definition as { owner: string | null }).owner
      add(
        object,
        `CREATE SCHEMA ${options.ifNotExists || object.name === 'public' ? 'IF NOT EXISTS ' : ''}${q(object.name)}${owner ? ` AUTHORIZATION ${q(owner)}` : ''};`,
      )
    }
  for (const object of sequences)
    add(
      object,
      `CREATE SEQUENCE ${options.ifNotExists ? 'IF NOT EXISTS ' : ''}${objectName(object, objects, 'postgresql18')} ${postgresSequence(object.definition as SequenceDefinition)};`,
    )
  for (const object of tables) {
    const table = object.definition as TableDefinition
    const constraints = table.constraints.filter(
      (v) => v.kind !== 'foreign_key' && !(v.kind === 'check' && v.notValid),
    )
    add(
      object,
      `CREATE TABLE ${options.ifNotExists ? 'IF NOT EXISTS ' : ''}${objectName(object, objects, 'postgresql18')} (\n  ${[...table.columns.map(postgresColumn), ...constraints.map((v) => postgresConstraint(v, table, objects))].join(',\n  ')}\n)${table.options.fillfactor !== undefined && table.options.fillfactor !== null ? ` WITH (fillfactor = ${table.options.fillfactor})` : ''};`,
    )
    for (const index of table.indexes)
      add(object, postgresIndex(object, index, objects, options.ifNotExists), !index.concurrently)
  }
  for (const object of tables) {
    const table = object.definition as TableDefinition
    for (const constraint of table.constraints.filter(
      (v) => v.kind === 'foreign_key' || (v.kind === 'check' && v.notValid),
    )) {
      const statement = `ALTER TABLE ${objectName(object, objects, 'postgresql18')} ADD ${postgresConstraint(constraint, table, objects)};`
      const concurrentReference =
        constraint.kind === 'foreign_key' &&
        tables.some(
          (v) =>
            v.objectKey === constraint.referenceTableKey &&
            (v.definition as TableDefinition).indexes.some(
              (v) =>
                v.unique &&
                v.concurrently &&
                v.columns.every((c, i) => c.columnKey === constraint.referenceColumns[i]),
            ),
        )
      add(
        object,
        options.ifNotExists
          ? `DO $dbcenter$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid=${literal(objectName(object, objects, 'postgresql18'))}::regclass AND conname=${literal(constraint.name)}) THEN EXECUTE ${literal(statement)}; END IF; END $dbcenter$;`
          : statement,
        !concurrentReference,
      )
    }
  }
  for (const object of sequences) {
    const owner = (object.definition as SequenceDefinition).ownedBy
    if (owner) {
      const table = tables.find((v) => v.objectKey === owner.tableKey)!
      add(
        object,
        `ALTER SEQUENCE ${objectName(object, objects, 'postgresql18')} OWNED BY ${objectName(table, objects, 'postgresql18')}.${tableColumns(table.definition as TableDefinition, [owner.columnKey])};`,
      )
    }
  }
  for (const view of views) {
    const schema = schemas.find((v) => v.objectKey === view.schemaKey)!
    add(view, `SET ${options.transaction ? 'LOCAL ' : ''}search_path TO ${q(schema.name)}, public;`)
    add(view, postgresView(view, objects, options.ifNotExists))
  }
  if (views.length)
    add(null, `${options.transaction ? 'SET LOCAL search_path TO DEFAULT' : 'RESET search_path'};`)
  if (options.includeComments)
    for (const object of objects)
      for (const statement of postgresComments(object, objects)) add(object, statement)
  if (options.versionTable)
    for (const statement of postgresVersionTable(context))
      add(null, statement, !steps.some((v) => !v.transactional))
  const result = scriptResult(context, steps, options.transaction)
  await sql.validateDdl(
    'postgresql18',
    result.steps.map((v) => v.sql),
  )
  return result
}
