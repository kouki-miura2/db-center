import { expect, test } from 'vite-plus/test'

import { estimateTableSize, type SizeInput, type SizeTable } from './size-estimate.ts'
const table: SizeTable = {
  columns: [{ key: 'id', dataType: 'bigint', notNull: true }],
  constraints: [{ kind: 'primary_key', columns: ['id'] }],
  indexes: [],
  options: {},
}
const input: SizeInput = {
  unit: 'day',
  initialRows: 100,
  retentionYears: null,
  inserts: 24,
  updates: 10,
  deletes: 0,
  peakFactor: 2,
  memo: null,
}
test('equivalent hour/day/month rates produce the same yearly capacity', () => {
  const day = estimateTableSize('postgresql18', table, input)
  const hour = estimateTableSize('postgresql18', table, { ...input, unit: 'hour', inserts: 1 })
  const month = estimateTableSize('postgresql18', table, {
    ...input,
    unit: 'month',
    inserts: (24 * 365) / 12,
  })
  expect(day.snapshots).toEqual(hour.snapshots)
  expect(day.snapshots).toEqual(month.snapshots)
  expect(day.snapshots[1]!.rows).toBe(8860)
  expect(day.snapshots[1]!.indexBytes).toBeGreaterThan(0)
})
test('updates do not add rows; retention caps growth; net deletes never make rows negative', () => {
  const result = estimateTableSize('postgresql18', table, { ...input, retentionYears: 1 })
  expect(result.snapshots[1]!.rows).toBe(result.snapshots[3]!.rows)
  expect(
    estimateTableSize('postgresql18', table, { ...input, inserts: 0, updates: 10000, deletes: 100 })
      .snapshots[1]!.rows,
  ).toBe(0)
  expect(result.deadTuplesPerUnit).toBe(10)
  expect(estimateTableSize('sqlite3', table, input).walBytesPerUnit).toBeNull()
})
test('invalid values and overflowing calculations are refused', () => {
  for (const value of [-1, NaN, Infinity])
    expect(() => estimateTableSize('postgresql18', table, { ...input, inserts: value })).toThrow(
      RangeError,
    )
  expect(() =>
    estimateTableSize('postgresql18', table, { ...input, inserts: Number.MAX_VALUE }),
  ).toThrow()
  expect(() => estimateTableSize('postgresql18', table, { ...input, retentionYears: 0 })).toThrow()
})
