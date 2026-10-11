import { describe, expect, it } from 'vite-plus/test'

import type { DesignObject } from '../repository/object.repository.ts'
import { tableDefinitionSchema, type TableDefinition } from './definition.ts'
import { canonical, diffDesigns } from './design-diff.ts'

const table = (): DesignObject => ({
  id: 'row',
  objectKey: 'stable',
  versionId: 'v',
  kind: 'table',
  name: 'users',
  logicalName: null,
  schemaKey: null,
  definition: tableDefinitionSchema.parse({
    columns: ['id', 'age'].map((name) => ({
      key: crypto.randomUUID(),
      name,
      logicalName: null,
      dataType: 'integer',
      notNull: false,
      defaultValue: null,
      comment: null,
      generation: null,
      collation: null,
    })),
    constraints: [],
    indexes: [],
    options: {},
    size: null,
  }),
  updatedBy: 'u',
  updatedAt: 1,
  revision: 1,
  deletedAt: null,
})
describe('stable design differences', () => {
  it('keeps renamed objects and columns as changes, excluding row metadata and property order', () => {
    const old = table(),
      next = structuredClone(old)
    next.id = 'other-row'
    next.versionId = 'next'
    next.revision = 8
    next.name = 'people'
    const column = (next.definition as TableDefinition).columns[1]!
    column.name = 'years'
    const result = diffDesigns([old], [next], 'postgresql18')
    expect(result.counts).toEqual({ added: 0, changed: 1, deleted: 0 })
    expect(result.changes.map((v) => [v.entity, v.action])).toEqual([
      ['object', 'renamed'],
      ['column', 'renamed'],
    ])
    expect(result.impact.dataLoss).toBe(false)
    expect(canonical({ a: 1, b: 2 })).toBe(canonical({ b: 2, a: 1 }))
    next.name = old.name
    column.name = 'age'
    expect(diffDesigns([old], [next], 'postgresql18').changes).toEqual([])
  })
  it('detects only column order without reporting deletions or additions', () => {
    const old = table(),
      next = structuredClone(old)
    ;(next.definition as TableDefinition).columns.reverse()
    const result = diffDesigns([old], [next], 'sqlite3')
    expect(result.changes).toHaveLength(1)
    expect(result.changes[0]).toMatchObject({
      entity: 'column_order',
      action: 'changed',
      impact: { dataLoss: false, recreation: true },
    })
  })
  it('classifies narrowing, widening, deletion, generated columns, and concurrent indexes', () => {
    const old = table(),
      next = structuredClone(old),
      definition = next.definition as TableDefinition
    definition.columns[1]!.dataType = 'bigint'
    expect(diffDesigns([old], [next], 'postgresql18').impact.dataLoss).toBe(false)
    definition.columns[1]!.dataType = 'smallint'
    expect(diffDesigns([old], [next], 'postgresql18').impact.dataLoss).toBe(true)
    definition.columns.pop()
    definition.indexes.push({
      key: crypto.randomUUID(),
      name: 'ix',
      method: 'btree',
      columns: [
        { columnKey: definition.columns[0]!.key, expression: null, order: 'ASC', nulls: null },
      ],
      include: [],
      where: null,
      unique: false,
      fillfactor: null,
      concurrently: true,
    })
    expect(diffDesigns([old], [next], 'postgresql18').impact).toMatchObject({
      dataLoss: true,
      outsideTransaction: true,
    })
    expect(diffDesigns([old], [], 'postgresql18').counts.deleted).toBe(1)
    expect(diffDesigns([old], [{ ...old, deletedAt: 2 }], 'postgresql18').counts.deleted).toBe(1)
  })
  it('ignores index and constraint display order and keeps documentation changes', () => {
    const old = table(),
      t = old.definition as TableDefinition
    t.constraints = [
      {
        key: crypto.randomUUID(),
        name: 'ck1',
        kind: 'check',
        expression: 'id > 0',
        notValid: false,
      },
      {
        key: crypto.randomUUID(),
        name: 'ck2',
        kind: 'check',
        expression: 'age > 0',
        notValid: false,
      },
    ]
    const next = structuredClone(old),
      n = next.definition as TableDefinition
    n.constraints.reverse()
    expect(diffDesigns([old], [next], 'postgresql18').changes).toEqual([])
    n.columns[0]!.comment = 'Identifier'
    expect(diffDesigns([old], [next], 'postgresql18').changes[0]).toMatchObject({
      fields: ['comment'],
      impact: { dataLoss: false, recreation: false },
    })
  })
})
