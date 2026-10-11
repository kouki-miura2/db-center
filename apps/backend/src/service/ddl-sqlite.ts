import type { VersionContext } from '../dao/object.interface.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import {
  invalidDdl,
  normalizedDesign,
  quoteIdentifier as q,
  scriptResult,
  selectSql,
  tableColumns,
  type DdlOptions,
  type SqlStep,
} from './ddl.ts'
import type { DesignColumn, TableDefinition, ViewDefinition } from './definition.ts'

export const sqliteColumn = (
  column: DesignColumn,
  primary: TableDefinition['constraints'][number] | undefined,
) => {
  const clauses = [q(column.name), column.dataType]
  if (column.collation) clauses.push(`COLLATE ${q(column.collation)}`)
  if (primary && column.autoincrement)
    clauses.push(`CONSTRAINT ${q(primary.name)} PRIMARY KEY AUTOINCREMENT`)
  if (column.generation?.kind === 'generated')
    clauses.push(
      `GENERATED ALWAYS AS (${column.generation.expression}) ${column.generation.stored ? 'STORED' : 'VIRTUAL'}`,
    )
  if (column.defaultValue !== null) clauses.push(`DEFAULT (${column.defaultValue})`)
  if (column.notNull) clauses.push('NOT NULL')
  return clauses.join(' ')
}
export const sqliteConstraint = (
  constraint: TableDefinition['constraints'][number],
  table: TableDefinition,
  objects: DesignObject[],
) => {
  const prefix = `CONSTRAINT ${q(constraint.name)}`
  if (constraint.kind === 'primary_key')
    return `${prefix} PRIMARY KEY (${tableColumns(table, constraint.columns)})`
  if (constraint.kind === 'unique')
    return `${prefix} UNIQUE (${tableColumns(table, constraint.columns)})`
  if (constraint.kind === 'check') return `${prefix} CHECK (${constraint.expression})`
  const target = objects.find(
    (v) => v.kind === 'table' && v.objectKey === constraint.referenceTableKey,
  )
  if (!target) return invalidDdl('外部キーの参照先がありません')
  return `${prefix} FOREIGN KEY (${tableColumns(table, constraint.columns)}) REFERENCES ${q(target.name)} (${tableColumns(target.definition as TableDefinition, constraint.referenceColumns)}) ON UPDATE ${constraint.onUpdate} ON DELETE ${constraint.onDelete}${constraint.deferrable ? ` DEFERRABLE INITIALLY ${constraint.initiallyDeferred ? 'DEFERRED' : 'IMMEDIATE'}` : ''}`
}
export const sqliteTable = (
  object: DesignObject,
  objects: DesignObject[],
  ifNotExists = false,
  name = object.name,
) => {
  const table = object.definition as TableDefinition
  const primary = table.constraints.find((v) => v.kind === 'primary_key')
  const inlinePk = table.columns.some((v) => v.autoincrement)
  const options = [
    ...(table.options.strict ? ['STRICT'] : []),
    ...(table.options.withoutRowid ? ['WITHOUT ROWID'] : []),
  ]
  return `CREATE TABLE ${ifNotExists ? 'IF NOT EXISTS ' : ''}${q(name)} (\n  ${[...table.columns.map((v) => sqliteColumn(v, primary)), ...table.constraints.filter((v) => !(inlinePk && v.kind === 'primary_key')).map((v) => sqliteConstraint(v, table, objects))].join(',\n  ')}\n)${options.length ? ` ${options.join(', ')}` : ''};`
}
export const sqliteIndex = (
  object: DesignObject,
  index: TableDefinition['indexes'][number],
  ifNotExists = false,
) => {
  const table = object.definition as TableDefinition
  const columns = index.columns
    .map(
      (v) => `${v.columnKey ? tableColumns(table, [v.columnKey]) : `(${v.expression})`} ${v.order}`,
    )
    .join(', ')
  return `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${ifNotExists ? 'IF NOT EXISTS ' : ''}${q(index.name)} ON ${q(object.name)} (${columns})${index.where ? ` WHERE (${index.where})` : ''};`
}
export const sqliteView = (object: DesignObject, ifNotExists = false) =>
  `CREATE VIEW ${ifNotExists ? 'IF NOT EXISTS ' : ''}${q(object.name)} AS\n${selectSql((object.definition as ViewDefinition).select)}\n;`
export const generateSqliteDdl = async (
  context: VersionContext,
  input: DesignObject[],
  sql: SqlValidator,
  options: DdlOptions,
) => {
  if (options.versionTable) invalidDdl('SQLite のバージョン管理テーブル出力は未対応です')
  const objects = await normalizedDesign(context, input, sql),
    steps: SqlStep[] = []
  const add = (object: DesignObject | null, statement: string) =>
    steps.push({ objectKey: object?.objectKey ?? null, sql: statement, transactional: true })
  const tables = objects
      .filter((v) => v.kind === 'table')
      .toSorted((a, b) => a.name.localeCompare(b.name)),
    views = objects
      .filter((v) => v.kind === 'view')
      .toSorted((a, b) => a.name.localeCompare(b.name))
  for (const view of views)
    if (Object.keys((view.definition as ViewDefinition).options).length)
      invalidDdl('SQLite のビューに PostgreSQL のオプションは指定できません')
  steps.push({
    objectKey: null,
    sql: `PRAGMA foreign_keys = ${options.dropExisting ? 'OFF' : 'ON'};`,
    transactional: false,
    beforeTransaction: true,
  })
  if (options.dropExisting)
    for (const object of [...views, ...tables])
      add(object, `DROP ${object.kind.toUpperCase()} IF EXISTS ${q(object.name)};`)
  for (const table of tables) add(table, sqliteTable(table, objects, options.ifNotExists))
  for (const table of tables)
    for (const index of (table.definition as TableDefinition).indexes)
      add(table, sqliteIndex(table, index, options.ifNotExists))
  for (const view of views) add(view, sqliteView(view, options.ifNotExists))
  add(null, 'PRAGMA foreign_key_check;')
  if (options.dropExisting)
    steps.push({ objectKey: null, sql: 'PRAGMA foreign_keys = ON;', transactional: false })
  const result = scriptResult(context, steps, options.transaction)
  await sql.validateDdl(
    'sqlite3',
    result.steps.map((v) => v.sql),
  )
  return result
}
