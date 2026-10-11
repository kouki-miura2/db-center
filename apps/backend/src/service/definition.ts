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
  comment: text(LIMITS.commentMaxLength).nullable().default(null),
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
export const viewDefinitionSchema = z.strictObject({
  select: text(LIMITS.versionDefinitionBytes).min(1),
  comment: text(LIMITS.commentMaxLength).nullable().default(null),
  options: z
    .strictObject({
      securityInvoker: z.boolean().optional(),
      securityBarrier: z.boolean().optional(),
      checkOption: z.enum(['LOCAL', 'CASCADED']).nullable().optional(),
      withData: z.boolean().optional(),
    })
    .default({}),
})
const integer64 = z
  .string()
  .regex(/^-?\d+$/)
  .refine(
    (v) => BigInt(v) >= -(2n ** 63n) && BigInt(v) <= 2n ** 63n - 1n,
    '64ビット整数を指定してください',
  )
export const sequenceDefinitionSchema = z.strictObject({
  dataType: z.enum(['smallint', 'integer', 'bigint']),
  start: integer64,
  increment: integer64,
  min: integer64.nullable(),
  max: integer64.nullable(),
  cache: integer64,
  cycle: z.boolean(),
  ownedBy: z.strictObject({ tableKey: z.uuid(), columnKey: z.uuid() }).nullable(),
  comment: text(LIMITS.commentMaxLength).nullable(),
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
  ...(['view', 'materialized_view'] as const).map((kind) =>
    z.strictObject({
      kind: z.literal(kind),
      name: expression,
      logicalName: text(LIMITS.logicalNameMaxLength).nullable(),
      schemaKey: z.uuid().nullable(),
      definition: viewDefinitionSchema,
    }),
  ),
  z.strictObject({
    kind: z.literal('sequence'),
    name: expression,
    logicalName: text(LIMITS.logicalNameMaxLength).nullable(),
    schemaKey: z.uuid(),
    definition: sequenceDefinitionSchema,
  }),
])
export type TableDefinition = z.infer<typeof tableDefinitionSchema>
export type ObjectInput = z.infer<typeof objectInputSchema>
export type DesignColumn = z.infer<typeof designColumnSchema>
export type ViewDefinition = z.infer<typeof viewDefinitionSchema>
export type SequenceDefinition = z.infer<typeof sequenceDefinitionSchema>

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
  if (target === 'sqlite3') {
    if (definition.options.fillfactor !== undefined) fail('SQLite では fillfactor は指定できません')
    definition.columns.forEach((v) => {
      if (
        definition.options.strict &&
        !['INT', 'INTEGER', 'REAL', 'TEXT', 'BLOB', 'ANY'].includes(v.dataType.toUpperCase())
      )
        fail('STRICT のデータ型が正しくありません')
      if (
        v.autoincrement &&
        (v.dataType.toUpperCase() !== 'INTEGER' ||
          definition.options.withoutRowid ||
          !definition.constraints.some(
            (c) => c.kind === 'primary_key' && c.columns.length === 1 && c.columns[0] === v.key,
          ))
      )
        fail('AUTOINCREMENT には INTEGER 単一主キーが必要です')
    })
    definition.indexes.forEach((v) => {
      if (
        v.method !== 'btree' ||
        v.include.length ||
        v.fillfactor !== null ||
        v.concurrently ||
        v.columns.some((c) => c.nulls !== null)
      )
        fail('SQLite のインデックスに未対応の設定があります')
    })
    definition.constraints.forEach((v) => {
      if (
        ('notValid' in v && v.notValid) ||
        ('nullsDistinct' in v && !v.nullsDistinct) ||
        (v.kind === 'unique' && v.deferrable) ||
        (v.kind === 'foreign_key' && v.match !== 'SIMPLE')
      )
        fail('SQLite の制約に未対応の設定があります')
    })
  }
}

export const assertSequence = (v: SequenceDefinition): void => {
  const bits = v.dataType === 'smallint' ? 16n : v.dataType === 'integer' ? 32n : 64n
  const lower = -(2n ** (bits - 1n))
  const upper = 2n ** (bits - 1n) - 1n
  const increment = BigInt(v.increment)
  const min = v.min === null ? (increment > 0n ? 1n : lower) : BigInt(v.min)
  const max = v.max === null ? (increment > 0n ? upper : -1n) : BigInt(v.max)
  if (
    increment === 0n ||
    increment < lower ||
    increment > upper ||
    BigInt(v.cache) < 1n ||
    min < lower ||
    max > upper ||
    min >= max ||
    BigInt(v.start) < min ||
    BigInt(v.start) > max
  )
    throw new AppError('invalid_input', {
      message: 'シーケンスの範囲・増分・キャッシュが正しくありません',
    })
}
