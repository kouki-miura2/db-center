import { expect, test } from 'vite-plus/test'
import { reactive } from 'vue'

import {
  newObject,
  newColumn,
  duplicateObject,
  objectChanges,
  toInput,
  coveringIndexes,
  removeColumn,
  type DesignObject,
} from './object.ts'

const object = (key: string, name: string): DesignObject =>
  ({
    ...newObject('table', null, 'sqlite3'),
    name,
    objectKey: key,
    id: key,
    versionId: 'v1',
    updatedAt: 1,
    updatedBy: 'u1',
    revision: 1,
    deletedAt: null,
  }) as DesignObject
test('diff ignores transport metadata and JSON property order, detects rename, addition, deletion and child edits', () => {
  const a = object('a', 'orders'),
    b = object('b', 'customers')
  const unchanged = {
    ...a,
    updatedAt: 999,
    updatedBy: 'other',
    revision: 4,
    definition: JSON.parse(JSON.stringify(a.definition)),
  }
  expect(objectChanges([unchanged], [a]).modified).toBe(0)
  const current = { ...a, name: 'renamed' }
  expect(objectChanges([current, object('c', 'added')], [a, b])).toMatchObject({
    added: 1,
    modified: 1,
    deleted: 1,
  })
  if (current.kind === 'table') {
    current.definition.columns.push(newColumn('sqlite3'))
    expect(objectChanges([current], [a]).modified).toBe(1)
  }
})
test('duplicates issue fresh stable keys and remap self references while preserving external references and expressions', () => {
  const table = newObject('table', 'schema', 'postgresql18')
  if (table.kind !== 'table') throw new Error('fixture')
  const column = newColumn('postgresql18')
  column.name = 'id'
  table.definition.columns = [column]
  table.definition.constraints = [
    { key: 'pk', name: 'orders_pk', kind: 'primary_key', columns: [column.key] },
    {
      key: 'self',
      name: 'self_fk',
      kind: 'foreign_key',
      columns: [column.key],
      referenceTableKey: 'original',
      referenceColumns: [column.key],
    },
    {
      key: 'external',
      name: 'external_fk',
      kind: 'foreign_key',
      columns: [column.key],
      referenceTableKey: 'other',
      referenceColumns: ['other_column'],
    },
  ]
  table.definition.indexes = [
    {
      key: 'idx',
      name: 'orders_idx',
      columns: [{ columnKey: column.key, expression: null }],
      include: [],
      where: null,
    },
  ]
  const next = duplicateObject(reactive(table), 'original', 'copy')
  if (next.kind !== 'table') throw new Error('fixture')
  const newKey = next.definition.columns[0]!.key
  expect(newKey).not.toBe(column.key)
  expect(next.definition.constraints[1]).toMatchObject({
    referenceTableKey: 'copy',
    referenceColumns: [newKey],
    columns: [newKey],
  })
  expect(next.definition.constraints[2]).toMatchObject({
    referenceTableKey: 'other',
    referenceColumns: ['other_column'],
    columns: [newKey],
  })
  expect(next.definition.indexes[0]!.columns[0]!.columnKey).toBe(newKey)
  expect(
    new Set(
      [...next.definition.columns, ...next.definition.constraints, ...next.definition.indexes].map(
        (v) => v.key,
      ),
    ).size,
  ).toBe(5)
  expect(table.definition.columns[0]!.key).toBe(column.key)
})
test('drafts detach reactive cache values; deleting a column removes only dependent local definitions', () => {
  const cached = reactive(object('a', 'orders'))
  const draft = toInput(cached)
  draft.name = 'draft'
  expect(cached.name).toBe('orders')
  if (draft.kind !== 'table') throw new Error('fixture')
  const a = newColumn('sqlite3'),
    b = newColumn('sqlite3')
  draft.definition.columns = [a, b]
  draft.definition.constraints = [{ key: 'pk', name: 'pk', kind: 'primary_key', columns: [a.key] }]
  draft.definition.indexes = [
    { key: 'i1', name: 'i1', columns: [{ columnKey: a.key, expression: null }] },
    { key: 'i2', name: 'i2', columns: [{ columnKey: b.key, expression: null }], include: [a.key] },
  ]
  expect(coveringIndexes(draft.definition, [a.key])).toEqual(['i1', 'pk'])
  removeColumn(draft.definition, a.key)
  expect(draft.definition.columns.map((c) => c.key)).toEqual([b.key])
  expect(draft.definition.constraints).toEqual([])
  expect(draft.definition.indexes).toHaveLength(1)
  expect(draft.definition.indexes[0]!.include).toEqual([])
})
