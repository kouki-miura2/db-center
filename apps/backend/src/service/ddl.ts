import type { Target } from 'utils'
import { z } from 'zod'

import type { VersionContext } from '../dao/object.interface.ts'
import { AppError } from '../error.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { objectInputSchema, type TableDefinition } from './definition.ts'
import { validateDesign } from './design-validation.ts'

export const ddlOptionsSchema = z.strictObject({
  includeSchemas: z.boolean().default(true),
  includeComments: z.boolean().default(true),
  transaction: z.boolean().default(true),
  ifNotExists: z.boolean().default(false),
  versionTable: z.boolean().default(false),
  dropExisting: z.boolean().default(false),
})
export type DdlOptions = z.infer<typeof ddlOptionsSchema>
export interface SqlStep {
  objectKey: string | null
  sql: string
  transactional: boolean
  beforeTransaction?: boolean
  phase?: 'constraint'
}
export const invalidDdl = (message: string): never => {
  throw new AppError('invalid_input', { message })
}
export const quoteIdentifier = (name: string) => `"${name.replaceAll('"', '""')}"`
export const sqlLiteral = (value: string, target: Target = 'postgresql18') =>
  target === 'postgresql18'
    ? `E'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "''")}'`
export const qualifiedIdentifier = (value: string) => {
  const tokens = value.match(/"(?:[^"]|"")*"|[^.\s"]+/g) ?? []
  if (!tokens.length || tokens.length > 2 || tokens.join('.') !== value)
    return invalidDdl('識別子を名前またはスキーマ.名前で指定してください')
  return tokens
    .map((v) => quoteIdentifier(v.startsWith('"') ? v.slice(1, -1).replaceAll('""', '"') : v))
    .join('.')
}
/** Remove only a statement terminator outside quoted SQL and comments. */
export const selectSql = (sql: string) => {
  let terminated = false
  let result = '',
    i = 0
  while (i < sql.length) {
    const rest = sql.slice(i)
    const dollar = /^\$(?:[a-zA-Z_][\w]*)?\$/.exec(rest)?.[0]
    if (rest.startsWith('--')) {
      const end = sql.indexOf('\n', i)
      const stop = end < 0 ? sql.length : end + 1
      result += sql.slice(i, stop)
      i = stop
    } else if (rest.startsWith('/*')) {
      let depth = 1,
        end = i + 2
      while (end < sql.length && depth) {
        if (sql.slice(end, end + 2) === '/*') {
          depth++
          end += 2
        } else if (sql.slice(end, end + 2) === '*/') {
          depth--
          end += 2
        } else end++
      }
      result += sql.slice(i, end)
      i = end
    } else if (dollar) {
      if (terminated) invalidDdl('SELECT 一文だけを指定してください')
      const end = sql.indexOf(dollar, i + dollar.length)
      const stop = end < 0 ? sql.length : end + dollar.length
      result += sql.slice(i, stop)
      i = stop
    } else if (sql[i] === "'" || sql[i] === '"' || sql[i] === '`' || sql[i] === '[') {
      if (terminated) invalidDdl('SELECT 一文だけを指定してください')
      const quote = sql[i] === '[' ? ']' : sql[i],
        escaped = quote === "'" && /[eE]/.test(sql[i - 1] ?? '') && !/[\w]/.test(sql[i - 2] ?? '')
      let end = i + 1
      while (end < sql.length) {
        if (escaped && sql[end] === '\\') end += 2
        else if (sql[end] === quote && sql[end + 1] === quote) end += 2
        else if (sql[end++] === quote) break
      }
      result += sql.slice(i, end)
      i = end
    } else {
      if (terminated && !/\s/.test(sql[i]!)) invalidDdl('SELECT 一文だけを指定してください')
      if (sql[i] !== ';') result += sql[i]
      else terminated = true
      i++
    }
  }
  return result.trim()
}
export const objectName = (object: DesignObject, objects: DesignObject[], target: Target) => {
  if (target === 'sqlite3' || object.kind === 'schema') return quoteIdentifier(object.name)
  const schema = objects.find((v) => v.kind === 'schema' && v.objectKey === object.schemaKey)
  if (!schema) return invalidDdl('オブジェクトのスキーマがありません')
  return `${quoteIdentifier(schema.name)}.${quoteIdentifier(object.name)}`
}
export const tableColumns = (table: TableDefinition, keys: string[]) =>
  keys
    .map((key) => {
      const column = table.columns.find((v) => v.key === key)
      if (!column) return invalidDdl('対象カラムがありません')
      return quoteIdentifier(column.name)
    })
    .join(', ')
export const normalizedDesign = async (
  context: VersionContext,
  objects: DesignObject[],
  sql: SqlValidator,
) => {
  const normalized = objects
    .filter((v) => v.deletedAt === null)
    .map((v) => {
      const parsed = objectInputSchema.safeParse({
        kind: v.kind,
        name: v.name,
        logicalName: v.logicalName,
        schemaKey: v.schemaKey,
        definition: v.definition,
      })
      if (!parsed.success) return invalidDdl(`${v.name}: 設計の形式が正しくありません`)
      return { ...v, ...parsed.data }
    })
  if (
    context.target === 'sqlite3' &&
    normalized.some((v) => !['table', 'view'].includes(v.kind) || v.schemaKey !== null)
  )
    invalidDdl('SQLite に未対応のオブジェクトがあります')
  for (const object of normalized)
    if (object.kind === 'table')
      for (const column of object.definition.columns) {
        if (column.generation && column.defaultValue !== null)
          invalidDdl('生成列に DEFAULT は指定できません')
        if (context.target === 'sqlite3' && /^sqlite_/i.test(object.name))
          invalidDdl('sqlite_ で始まる名前は予約されています')
      }
  const result = await validateDesign(context, normalized, sql)
  if (result.errors)
    throw new AppError('invalid_input', {
      fields: Object.fromEntries(
        result.issues
          .filter((v) => v.severity === 'error')
          .map((v) => [`${v.objectKey}.${v.path}`, v.message]),
      ),
    })
  const keys = new Set<string>(),
    relations = new Set<string>()
  for (const object of normalized) {
    if (keys.has(object.objectKey)) invalidDdl('オブジェクトのキーが重複しています')
    keys.add(object.objectKey)
    const names = [
      object.name,
      ...(object.kind === 'table'
        ? [
            ...object.definition.indexes.map((v) => v.name),
            ...object.definition.constraints
              .filter((v) => v.kind === 'primary_key' || v.kind === 'unique')
              .map((v) => v.name),
          ]
        : []),
    ]
    for (const name of names) {
      const key = JSON.stringify([object.kind === 'schema' ? 'schema' : object.schemaKey, name])
      if (relations.has(key)) invalidDdl('スキーマ内のリレーション名が重複しています')
      relations.add(key)
    }
  }
  return normalized
}
export const orderedViews = async (target: Target, objects: DesignObject[], sql: SqlValidator) => {
  const views = objects
    .filter((v) => v.kind === 'view' || v.kind === 'materialized_view')
    .toSorted((a, b) => a.name.localeCompare(b.name))
  const dependencies = new Map<string, string[]>()
  for (const view of views) {
    const analysis = await sql.validateView(
      target,
      (view.definition as { select: string }).select,
      objects.filter((v) => v.objectKey !== view.objectKey),
      view.schemaKey,
    )
    dependencies.set(
      view.objectKey,
      analysis.dependencies.filter((key) => views.some((v) => v.objectKey === key)),
    )
  }
  const result: DesignObject[] = [],
    visited = new Set<string>(),
    visiting = new Set<string>()
  const visit = (view: DesignObject): void => {
    if (visited.has(view.objectKey)) return
    if (visiting.has(view.objectKey)) invalidDdl('ビューの依存が循環しています')
    visiting.add(view.objectKey)
    for (const key of dependencies.get(view.objectKey) ?? [])
      visit(views.find((v) => v.objectKey === key)!)
    visiting.delete(view.objectKey)
    visited.add(view.objectKey)
    result.push(view)
  }
  views.forEach(visit)
  return result
}
export const scriptResult = (
  context: VersionContext,
  steps: SqlStep[],
  transaction: boolean,
  warnings: string[] = [],
) => {
  const before = steps.filter((v) => v.beforeTransaction)
  const inside = steps.filter((v) => v.transactional && !v.beforeTransaction),
    outside = steps.filter((v) => !v.transactional && !v.beforeTransaction)
  const header =
    `-- ${context.databaseName} v${context.version.number} ${context.version.status} ${context.target}`.replace(
      /[\r\n]/g,
      ' ',
    )
  const statements = [
    header,
    ...before.map((v) => v.sql),
    ...(transaction && inside.length ? ['BEGIN;'] : []),
    ...inside.map((v) => v.sql),
    ...(transaction && inside.length ? ['COMMIT;'] : []),
    ...outside.map((v) => v.sql),
  ]
  return {
    sql: statements.join('\n\n') + '\n',
    steps: [...before, ...inside, ...outside],
    warnings,
  }
}
