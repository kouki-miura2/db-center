import { LIMITS, type Target } from 'utils'
import { z } from 'zod'

import { AppError } from '../error.ts'
import { text } from '../validation.ts'
import { assertColumns, columnSchema } from './column.ts'

export const expression = text(LIMITS.expressionMaxLength).min(1)
export const designColumnSchema = columnSchema.extend({ key: z.uuid() })
const keys = z.array(z.uuid()).min(1).max(LIMITS.columnsPerTable)
const constraintBase = { key: z.uuid(), name: expression }
export const constraintSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...constraintBase, kind: z.literal('primary_key'), columns: keys }),
  z.strictObject({
    ...constraintBase,
    kind: z.literal('unique'),
    columns: keys,
    nullsDistinct: z.boolean().default(true),
    deferrable: z.boolean().default(false),
    initiallyDeferred: z.boolean().default(false),
  }),
  z.strictObject({
    ...constraintBase,
    kind: z.literal('foreign_key'),
    columns: keys,
    referenceTableKey: z.uuid(),
    referenceColumns: keys,
    onDelete: z
      .enum(['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'])
      .default('NO ACTION'),
    onUpdate: z
      .enum(['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT'])
      .default('NO ACTION'),
    match: z.enum(['SIMPLE', 'FULL']).default('SIMPLE'),
    deferrable: z.boolean().default(false),
    initiallyDeferred: z.boolean().default(false),
    notValid: z.boolean().default(false),
  }),
  z.strictObject({
    ...constraintBase,
    kind: z.literal('check'),
    expression,
    notValid: z.boolean().default(false),
  }),
])
export const indexSchema = z.strictObject({
  key: z.uuid(),
  name: expression,
  method: z.enum(['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']).default('btree'),
  columns: z
    .array(
      z
        .strictObject({
          columnKey: z.uuid().nullable(),
          expression: expression.nullable(),
          order: z.enum(['ASC', 'DESC']).default('ASC'),
          nulls: z.enum(['FIRST', 'LAST']).nullable().default(null),
        })
        .refine(
          (v) => (v.columnKey === null) !== (v.expression === null),
          'カラムか式のいずれかを指定してください',
        ),
    )
    .min(1)
    .max(LIMITS.columnsPerTable),
  include: z.array(z.uuid()).max(LIMITS.columnsPerTable).default([]),
  where: expression.nullable().default(null),
  unique: z.boolean().default(false),
  fillfactor: z.number().int().min(10).max(100).nullable().default(null),
  concurrently: z.boolean().default(false),
})
export const sizeInputSchema = z.strictObject({
  unit: z.enum(['hour', 'day', 'month']),
  initialRows: z.number().finite().nonnegative(),
  retentionYears: z.number().finite().positive().nullable(),
  inserts: z.number().finite().nonnegative(),
  updates: z.number().finite().nonnegative(),
  deletes: z.number().finite().nonnegative(),
  peakFactor: z.number().finite().min(1),
  memo: text(LIMITS.commentMaxLength).nullable(),
})
export const schemaDefinitionSchema = z.strictObject({
  owner: expression.nullable().default(null),
  comment: text(LIMITS.commentMaxLength).nullable().default(null),
})
export const tableDefinitionSchema = z.strictObject({
  columns: z.array(designColumnSchema).max(LIMITS.columnsPerTable),
  constraints: z.array(constraintSchema),
  indexes: z.array(indexSchema),
  size: sizeInputSchema.nullable(),
  options: z.strictObject({
    fillfactor: z.number().int().min(10).max(100).nullable().optional(),
    strict: z.boolean().optional(),
    withoutRowid: z.boolean().optional(),
  }),
})
export const objectInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('schema'),
    name: expression,
    logicalName: text(LIMITS.logicalNameMaxLength).nullable(),
    schemaKey: z.null(),
    definition: schemaDefinitionSchema,
  }),
  z.strictObject({
    kind: z.literal('table'),
    name: expression,
    logicalName: text(LIMITS.logicalNameMaxLength).nullable(),
    schemaKey: z.uuid().nullable(),
    definition: tableDefinitionSchema,
  }),
])
export type TableDefinition = z.infer<typeof tableDefinitionSchema>
export type ObjectInput = z.infer<typeof objectInputSchema>
export type DesignColumn = z.infer<typeof designColumnSchema>

/** Shape and local references only: incomplete tables are deliberately editable. */
export const assertTableDefinition = (target: Target, definition: TableDefinition): void => {
  assertColumns(target, definition.columns, 'definition.columns')
  const fail = (message: string): never => {
    throw new AppError('invalid_input', { message })
  }
  const columns = new Set(definition.columns.map((v) => v.key))
  const allKeys = [
    ...columns,
    ...definition.constraints.map((v) => v.key),
    ...definition.indexes.map((v) => v.key),
  ]
  if (columns.size !== definition.columns.length || new Set(allKeys).size !== allKeys.length)
    fail('設計のキーが重複しています')
  const names = [...definition.constraints, ...definition.indexes].map((v) => v.name)
  if (new Set(names).size !== names.length) fail('制約・インデックス名が重複しています')
  const references = (refs: string[]) => {
    if (new Set(refs).size !== refs.length || refs.some((key) => !columns.has(key)))
      fail('対象カラムが正しくありません')
  }
  if (definition.constraints.filter((v) => v.kind === 'primary_key').length > 1)
    fail('主キーは一つだけ指定できます')
  definition.constraints.forEach((v) => {
    if ('columns' in v) references(v.columns)
    if (
      v.kind === 'foreign_key' &&
      (v.columns.length !== v.referenceColumns.length ||
        new Set(v.referenceColumns).size !== v.referenceColumns.length)
    )
      fail('外部キーのカラム数が一致しません')
    if ('initiallyDeferred' in v && v.initiallyDeferred && !v.deferrable)
      fail('遅延評価には DEFERRABLE が必要です')
  })
  definition.indexes.forEach((v) => {
    references(v.columns.flatMap((c) => (c.columnKey ? [c.columnKey] : [])))
    references(v.include)
    if (v.include.some((key) => v.columns.some((c) => c.columnKey === key)))
      fail('INCLUDE とキー列が重複しています')
    if (v.unique && v.method !== 'btree') fail('UNIQUE は btree のみ指定できます')
  })
  if (
    target === 'postgresql18' &&
    (definition.options.strict !== undefined || definition.options.withoutRowid !== undefined)
  )
    fail('SQLite のテーブルオプションは指定できません')
}
