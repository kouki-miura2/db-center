import type { Target } from '../target/target.ts'

export interface SizeInput {
  unit: 'hour' | 'day' | 'month'
  initialRows: number
  retentionYears: number | null
  inserts: number
  updates: number
  deletes: number
  peakFactor: number
  memo: string | null
}
export interface SizeColumn {
  key: string
  dataType: string
  notNull: boolean
}
export interface SizeTable {
  columns: SizeColumn[]
  constraints: { kind: string; columns?: string[]; elements?: { columnKey: string | null }[] }[]
  indexes: {
    columns: { columnKey: string | null }[]
    include: string[]
    fillfactor: number | null
  }[]
  options: { fillfactor?: number | null }
}
const align = (n: number) => Math.ceil(n / 8) * 8
/** Fixed types use their widths; variable types are assumptions, never exact storage measurements. */
export const estimateColumnBytes = (target: Target, dataType: string): number => {
  const type = dataType.trim().toLowerCase()
  const fixed: Record<string, number> = {
    boolean: 1,
    bool: 1,
    smallint: 2,
    int2: 2,
    smallserial: 2,
    integer: 4,
    int: 4,
    int4: 4,
    serial: 4,
    real: 4,
    float4: 4,
    date: 4,
    bigint: 8,
    int8: 8,
    bigserial: 8,
    'double precision': 8,
    float8: 8,
    float: 8,
    timestamp: 8,
    timestamptz: 8,
    time: 8,
    timetz: 12,
    interval: 16,
    uuid: 16,
    numeric: 16,
    decimal: 16,
  }
  if (target === 'sqlite3' && ['integer', 'int', 'real'].includes(type)) return 8
  if (fixed[type]) return fixed[type]
  if (/^(timestamp|time)\b/.test(type)) return 8
  if (/^(numeric|decimal)\b/.test(type)) return 16
  const length = /^(?:varchar|character varying|char|character)\s*\((\d+)\)$/.exec(type)?.[1]
  return length ? Number(length) / 2 + 4 : 36
}

/** Shared, deterministic capacity model; results are computed, never persisted. */
export const estimateTableSize = (target: Target, table: SizeTable, input: SizeInput) => {
  for (const value of [
    input.initialRows,
    input.inserts,
    input.updates,
    input.deletes,
    input.peakFactor,
    ...(input.retentionYears === null ? [] : [input.retentionYears]),
  ])
    if (!Number.isFinite(value) || value < 0)
      throw new RangeError('負の値・非有限数は指定できません')
  if (
    input.peakFactor < 1 ||
    (input.retentionYears !== null && input.retentionYears <= 0) ||
    !['hour', 'day', 'month'].includes(input.unit)
  )
    throw new RangeError('見積もり入力が正しくありません')
  const widths = new Map(table.columns.map((v) => [v.key, estimateColumnBytes(target, v.dataType)]))
  const payload = [...widths.values()].reduce((a, b) => a + b, 0)
  const averageRowBytes =
    target === 'postgresql18'
      ? align(
          align(
            23 + (table.columns.some((v) => !v.notNull) ? Math.ceil(table.columns.length / 8) : 0),
          ) + payload,
        ) + 4
      : 8 + 1 + table.columns.length + payload
  const fillfactor = table.options.fillfactor ?? 100
  if (!Number.isFinite(fillfactor) || fillfactor < 10 || fillfactor > 100)
    throw new RangeError('fillfactor が正しくありません')
  const indexes = [
    ...table.indexes.map((v) => ({
      keys: [...v.columns.map((c) => c.columnKey), ...v.include],
      fillfactor: v.fillfactor ?? 90,
    })),
    ...table.constraints
      .filter((v) => v.kind === 'primary_key' || v.kind === 'unique' || v.kind === 'exclude')
      .map((v) => ({
        keys:
          v.kind === 'exclude' ? (v.elements?.map((e) => e.columnKey) ?? []) : (v.columns ?? []),
        fillfactor: 90,
      })),
  ]
  const perIndex = indexes.map((v) => {
    if (!Number.isFinite(v.fillfactor) || v.fillfactor < 10 || v.fillfactor > 100)
      throw new RangeError('index fillfactor が正しくありません')
    return (
      align(
        16 +
          v.keys.reduce<number>(
            (sum, key) => sum + (key === null ? 36 : (widths.get(key) ?? 36)),
            0,
          ),
      ) /
      (v.fillfactor / 100)
    )
  })
  const unitsPerYear = input.unit === 'hour' ? 365 * 24 : input.unit === 'day' ? 365 : 12
  const unitsPerSecond = unitsPerYear / (365 * 24 * 60 * 60)
  const snapshots = [0, 1, 3, 5].map((years) => {
    const horizon = Math.min(years, input.retentionYears ?? years)
    const rows = Math.max(
      0,
      Math.round(input.initialRows + (input.inserts - input.deletes) * unitsPerYear * horizon),
    )
    const tableBytes =
      rows === 0 ? 0 : Math.ceil((rows * averageRowBytes) / (fillfactor / 100) / (8192 - 24)) * 8192
    const indexSizes = perIndex.map((width) =>
      rows === 0 ? 0 : Math.ceil((rows * width) / (8192 - 24)) * 8192,
    )
    const indexBytes = indexSizes.reduce((sum, value) => sum + value, 0)
    return { years, rows, tableBytes, indexBytes, indexSizes, totalBytes: tableBytes + indexBytes }
  })
  const peakWritesPerSecond =
    (input.inserts + input.updates + input.deletes) * unitsPerSecond * input.peakFactor
  const deadTuplesPerUnit = target === 'postgresql18' ? input.updates + input.deletes : 0
  const walBytesPerUnit =
    target === 'postgresql18'
      ? (input.inserts + 2 * input.updates + input.deletes) *
        (averageRowBytes + perIndex.reduce((a, b) => a + b, 0))
      : null
  const numbers = [
    ...snapshots.flatMap((v) => [v.rows, v.tableBytes, v.indexBytes, v.totalBytes]),
    averageRowBytes,
    peakWritesPerSecond,
    deadTuplesPerUnit,
    ...(walBytesPerUnit === null ? [] : [walBytesPerUnit]),
  ]
  if (numbers.some((v) => !Number.isFinite(v) || v > Number.MAX_SAFE_INTEGER))
    throw new RangeError('見積もりが計算可能な範囲を超えています')
  return { averageRowBytes, snapshots, peakWritesPerSecond, deadTuplesPerUnit, walBytesPerUnit }
}
