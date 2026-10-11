import { expect, test } from 'vite-plus/test'

import { assertColumns, type Column, columnSchema } from './column.ts'

const column = (overrides: Partial<Column> = {}): Column => ({
  name: 'created_at',
  logicalName: '登録日時',
  dataType: 'timestamptz',
  notNull: true,
  defaultValue: 'now()',
  comment: null,
  generation: null,
  collation: null,
  ...overrides,
})

const problems = (target: 'postgresql18' | 'sqlite3', columns: Column[]) => {
  try {
    assertColumns(target, columns, 'columns')
    return {}
  } catch (error) {
    return (error as { fields: Record<string, string> }).fields
  }
}

test('accepts columns that fit the target', () => {
  expect(
    problems('postgresql18', [
      column(),
      column({
        name: 'id',
        dataType: 'bigint',
        defaultValue: null,
        generation: { kind: 'identity', always: true },
        storage: 'plain',
      }),
    ]),
  ).toEqual({})
  expect(
    problems('sqlite3', [
      column({ dataType: 'TEXT', defaultValue: "datetime('now')", collation: 'NOCASE' }),
      column({ name: 'id', dataType: 'INTEGER', defaultValue: null, autoincrement: true }),
    ]),
  ).toEqual({})
})

test('refuses duplicate names and names over the target’s byte limit', () => {
  expect(problems('postgresql18', [column(), column(), column({ name: 'a'.repeat(64) })])).toEqual({
    'columns.1.name': '同じ名前のカラムがあります',
    'columns.2.name': '63バイト以内で入力してください',
  })
  expect(problems('sqlite3', [column({ name: 'a'.repeat(64) })])).toEqual({})
})

test('refuses a default value on a generated column', () => {
  expect(
    problems('postgresql18', [column({ generation: { kind: 'identity', always: false } })]),
  ).toHaveProperty('columns.0.defaultValue')
})

test('refuses fields of the other target', () => {
  expect(problems('postgresql18', [column({ autoincrement: true })])).toHaveProperty(
    'columns.0.autoincrement',
  )
  expect(
    problems('sqlite3', [
      column({
        defaultValue: null,
        generation: { kind: 'identity', always: true },
        storage: 'main',
        compression: 'lz4',
        collation: 'ja-x-icu',
      }),
    ]),
  ).toEqual({
    'columns.0.generation': 'SQLite 3 では IDENTITY を指定できません',
    'columns.0.storage': 'この項目は指定できません',
    'columns.0.compression': 'この項目は指定できません',
    'columns.0.collation': 'BINARY / NOCASE / RTRIM のいずれかを指定してください',
  })
})

test('the schema rejects unknown fields and missing ones', () => {
  expect(columnSchema.safeParse(column()).success).toBe(true)
  expect(columnSchema.safeParse({ ...column(), extra: 1 }).success).toBe(false)
  const withoutNotNull: Partial<Column> = column()
  delete withoutNotNull.notNull
  expect(columnSchema.safeParse(withoutNotNull).success).toBe(false)
})
