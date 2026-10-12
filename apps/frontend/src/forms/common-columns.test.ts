import { expect, test } from 'vite-plus/test'

import {
  commonColumnsReady,
  copyCommonColumns,
  newCommonColumn,
  normalizeCommonColumns,
} from './common-columns.ts'
test('editing the draft never modifies the cached generation; optional fields normalize without losing false values', () => {
  const columns = [
    {
      ...newCommonColumn(),
      name: ' created_at ',
      dataType: ' timestamp ',
      logicalName: ' ',
      generation: { kind: 'generated' as const, expression: ' now() ', stored: false },
    },
  ]
  const draft = copyCommonColumns(columns)
  if (draft[0]?.generation?.kind === 'generated')
    draft[0].generation.expression = 'clock_timestamp()'
  expect(columns[0]?.generation.expression).toBe(' now() ')
  expect(normalizeCommonColumns(columns)[0]).toMatchObject({
    name: 'created_at',
    dataType: 'timestamp',
    logicalName: null,
    defaultValue: null,
    generation: { expression: 'now()', stored: false },
    notNull: false,
  })
})
test('checks unopened rows and generated expressions, and accepts clearing the whole set', () => {
  const valid = { ...newCommonColumn(), name: 'created_at', dataType: 'timestamptz' }
  expect(commonColumnsReady([], 'postgresql18')).toBe(true)
  expect(commonColumnsReady([valid, newCommonColumn()], 'postgresql18')).toBe(false)
  expect(
    commonColumnsReady(
      [{ ...valid, generation: { kind: 'generated', expression: '', stored: true } }],
      'postgresql18',
    ),
  ).toBe(false)
  expect(commonColumnsReady([{ ...valid, name: 'あ'.repeat(22) }], 'postgresql18')).toBe(false)
  expect(commonColumnsReady([valid], 'postgresql18')).toBe(true)
})
