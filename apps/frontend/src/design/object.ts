import {
  estimateTableSize,
  type Target,
  LIMITS,
  charLength,
  isIdentifierWithinLimit,
  TARGETS,
} from 'utils'

import type { ObjectInput } from '../composables/useObjectMutations.ts'
import type { ObjectRecord } from '../composables/useVersionQuery.ts'
export type DesignObject = ObjectInput & Omit<ObjectRecord, keyof ObjectInput>
export type Table = Extract<ObjectInput, { kind: 'table' }>['definition']
export type Column = Table['columns'][number]
export type Constraint = Table['constraints'][number]
export type Index = Table['indexes'][number]
export type Sequence = Extract<ObjectInput, { kind: 'sequence' }>['definition']
export type View = Extract<ObjectInput, { kind: 'view' | 'materialized_view' }>['definition']
export const kindLabels = {
  schema: 'スキーマ',
  table: 'テーブル',
  view: 'ビュー',
  materialized_view: 'マテビュー',
  sequence: 'シーケンス',
} as const
export const kindIcons = {
  schema: 'mdi-folder-outline',
  table: 'mdi-table',
  view: 'mdi-table-multiple',
  materialized_view: 'mdi-layers-outline',
  sequence: 'mdi-format-list-numbered',
} as const
export const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
export const toInput = (row: ObjectRecord): ObjectInput =>
  ({
    kind: row.kind,
    name: row.name,
    logicalName: row.logicalName,
    schemaKey: row.schemaKey,
    definition: copy(row.definition),
  }) as ObjectInput
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).toSorted(([a], [b]) => a.localeCompare(b)))
      : item,
  )
export const changeOf = (row: unknown, previous: unknown) =>
  !previous ? 'A' : canonical(row) === canonical(previous) ? '' : 'M'
export const objectChanges = (rows: ObjectRecord[], previous: ObjectRecord[]) => {
  const source = new Map(previous.map((row) => [row.objectKey, row]))
  const changes = new Map(
    rows.map((row) => [
      row.objectKey,
      changeOf(
        toInput(row),
        source.has(row.objectKey) ? toInput(source.get(row.objectKey)!) : undefined,
      ),
    ]),
  )
  return {
    changes,
    added: [...changes.values()].filter((v) => v === 'A').length,
    modified: [...changes.values()].filter((v) => v === 'M').length,
    deleted: previous.filter((row) => !rows.some((v) => v.objectKey === row.objectKey)).length,
  }
}
export const newColumn = (target: Target): Column => ({
  key: crypto.randomUUID(),
  name: '',
  logicalName: null,
  dataType: target === 'sqlite3' ? 'TEXT' : 'text',
  notNull: false,
  defaultValue: null,
  comment: null,
  generation: null,
  collation: null,
})
export const newObject = (
  kind: ObjectInput['kind'],
  schemaKey: string | null,
  target: Target,
): ObjectInput => {
  const base = { name: '', logicalName: null, schemaKey }
  if (kind === 'schema')
    return { ...base, kind, schemaKey: null, definition: { owner: null, comment: null } }
  if (kind === 'table')
    return {
      ...base,
      kind,
      definition: {
        comment: null,
        columns: [],
        constraints: [],
        indexes: [],
        size: null,
        options: target === 'sqlite3' ? { strict: true, withoutRowid: false } : {},
      },
    }
  if (kind === 'sequence')
    return {
      ...base,
      kind,
      schemaKey: schemaKey!,
      definition: {
        dataType: 'bigint',
        start: '1',
        increment: '1',
        min: null,
        max: null,
        cache: '1',
        cycle: false,
        ownedBy: null,
        comment: null,
      },
    }
  return { ...base, kind, definition: { select: 'SELECT ', comment: null, options: {} } }
}
export const duplicateObject = (
  input: ObjectInput,
  oldKey: string,
  newKey: string,
): ObjectInput => {
  const next = copy(input)
  next.name += '_copy'
  if (next.kind === 'table') {
    const map = new Map(next.definition.columns.map((col) => [col.key, crypto.randomUUID()]))
    const remap = (keys: string[]) => keys.map((key) => map.get(key) ?? key)
    next.definition.columns.forEach((col) => {
      col.key = map.get(col.key)!
    })
    next.definition.constraints.forEach((c) => {
      c.key = crypto.randomUUID()
      c.name += '_copy'
      if ('columns' in c) c.columns = remap(c.columns)
      if (c.kind === 'exclude')
        c.elements.forEach((e) => {
          if (e.columnKey) e.columnKey = map.get(e.columnKey)!
        })
      if (c.kind === 'foreign_key' && c.referenceTableKey === oldKey) {
        c.referenceTableKey = newKey
        c.referenceColumns = remap(c.referenceColumns)
      }
    })
    next.definition.indexes.forEach((i) => {
      i.key = crypto.randomUUID()
      i.name += '_copy'
      i.columns.forEach((c) => {
        if (c.columnKey) c.columnKey = map.get(c.columnKey)!
      })
      i.include = remap(i.include ?? [])
    })
  }
  return next
}
export const fullName = (row: Pick<ObjectRecord, 'schemaKey' | 'name'>, rows: ObjectRecord[]) =>
  [rows.find((v) => v.kind === 'schema' && v.objectKey === row.schemaKey)?.name, row.name]
    .filter(Boolean)
    .join('.')
export const defaultSize = (): NonNullable<Table['size']> => ({
  unit: 'day',
  initialRows: 0,
  inserts: 0,
  updates: 0,
  deletes: 0,
  peakFactor: 1,
  retentionYears: null,
  memo: null,
})
export const tableEstimate = (target: Target, table: Table) => {
  try {
    return estimateTableSize(
      target,
      {
        ...table,
        indexes: table.indexes.map((i) => ({
          ...i,
          include: i.include ?? [],
          fillfactor: i.fillfactor ?? null,
        })),
      },
      table.size ?? defaultSize(),
    )
  } catch {
    return undefined
  }
}
export const bytes = (value: number | undefined) =>
  value === undefined
    ? '—'
    : value >= 1024 ** 3
      ? `${(value / 1024 ** 3).toFixed(2)} GB`
      : value >= 1024 ** 2
        ? `${(value / 1024 ** 2).toFixed(1)} MB`
        : value >= 1024
          ? `${(value / 1024).toFixed(1)} KB`
          : `${Math.round(value)} B`
export const coveringIndexes = (table: Table, columns: string[]) =>
  [
    ...table.indexes
      .filter((i) => !i.where)
      .map((i) => ({ name: i.name, columns: i.columns.map((c) => c.columnKey) })),
    ...table.constraints.flatMap((c) =>
      c.kind === 'primary_key' || c.kind === 'unique' ? [{ name: c.name, columns: c.columns }] : [],
    ),
  ]
    .filter((i) => columns.length > 0 && columns.every((c, index) => c === i.columns[index]))
    .map((i) => i.name)
export const removeColumn = (table: Table, key: string) => {
  table.columns = table.columns.filter((c) => c.key !== key)
  table.constraints = table.constraints.filter(
    (c) =>
      !('columns' in c && c.columns.includes(key)) &&
      !(c.kind === 'exclude' && c.elements.some((e) => e.columnKey === key)),
  )
  table.indexes = table.indexes
    .filter((i) => !i.columns.some((c) => c.columnKey === key))
    .map((i) => ({ ...i, include: (i.include ?? []).filter((k) => k !== key) }))
}
export const inputProblems = (input: ObjectInput, target: Target): Record<string, string> => {
  const fields: Record<string, string> = {}
  const inspect = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => inspect(item, path + '.' + index))
      return
    }
    if (value && typeof value === 'object') {
      Object.entries(value).forEach(([key, item]) => inspect(item, path ? path + '.' + key : key))
      return
    }
    const key = path.split('.').at(-1)
    if (
      key === 'name' &&
      (typeof value !== 'string' ||
        !value.trim() ||
        value.includes('\0') ||
        !isIdentifierWithinLimit(target, value) ||
        charLength(value) > LIMITS.expressionMaxLength)
    )
      fields[path] =
        `物理名は${target === 'sqlite3' ? LIMITS.expressionMaxLength + '文字' : TARGETS[target].identifierMaxBytes + 'バイト'}以内で入力してください`
    if (typeof value !== 'string') return
    const limit =
      key === 'logicalName'
        ? LIMITS.logicalNameMaxLength
        : key === 'comment' || key === 'memo'
          ? LIMITS.commentMaxLength
          : [
                'dataType',
                'expression',
                'defaultValue',
                'collation',
                'operatorClass',
                'owner',
                'operator',
              ].includes(key ?? '')
            ? LIMITS.expressionMaxLength
            : undefined
    if (limit && charLength(value) > limit) fields[path] = `${limit}文字以内で入力してください`
  }
  inspect(input, '')
  if (input.kind === 'table' && input.definition.columns.length > LIMITS.columnsPerTable)
    fields['definition.columns'] = `カラムは${LIMITS.columnsPerTable}件以内で指定してください`
  return fields
}
export const fieldLabel = (path: string, input: ObjectInput) => {
  const labels: Record<string, string> = {
    name: '物理名',
    logicalName: '論理名',
    dataType: 'データ型',
    comment: 'コメント',
    memo: 'メモ',
    notNull: 'NOT NULL',
    defaultValue: 'デフォルト値',
    generation: '値の生成',
    collation: '照合順序',
    storage: 'ストレージ',
    compression: '圧縮',
    columns: '対象カラム',
    indexes: 'インデックス',
    constraints: '制約',
    size: 'サイズ設計',
    schemaKey: 'スキーマ',
    owner: '所有者ロール',
    expression: '式',
    referenceTableKey: '参照先テーブル',
    referenceColumns: '参照先カラム',
    start: '開始値',
    increment: '増分',
    cache: 'キャッシュ',
    min: '最小値',
    max: '最大値',
  }
  const parts = path.split('.'),
    kind = parts[1],
    index = Number(parts[2])
  const name =
    input.kind === 'table' && ['columns', 'constraints', 'indexes'].includes(kind ?? '')
      ? input.definition[kind as 'columns' | 'constraints' | 'indexes'][index]?.name ||
        `${index + 1}行目`
      : ''
  return [name, labels[parts.at(-1) ?? ''] ?? labels[kind ?? ''] ?? '入力項目']
    .filter(Boolean)
    .join('：')
}
