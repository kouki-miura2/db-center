import { expect, test } from 'vite-plus/test'

import { assertTableDefinition, objectInputSchema, tableDefinitionSchema } from './definition.ts'

export const tableFixture = () =>
  tableDefinitionSchema.parse({
    columns: [
      {
        key: crypto.randomUUID(),
        name: 'id',
        logicalName: null,
        dataType: 'bigint',
        notNull: true,
        defaultValue: null,
        comment: null,
        generation: null,
        collation: null,
      },
    ],
    constraints: [],
    indexes: [],
    size: null,
    options: {},
  })

test('incomplete tables can be saved; unknown fields and nonfinite inputs cannot', () => {
  expect(() => assertTableDefinition('postgresql18', tableFixture())).not.toThrow()
  expect(tableDefinitionSchema.safeParse({ ...tableFixture(), unknown: true }).success).toBe(false)
  expect(
    objectInputSchema.safeParse({
      kind: 'schema',
      name: 'public',
      logicalName: null,
      schemaKey: null,
      definition: {},
    }).success,
  ).toBe(true)
})
test('duplicate keys, missing local columns, and incompatible options are refused', () => {
  const table = tableFixture()
  table.columns.push({ ...table.columns[0]! })
  expect(() => assertTableDefinition('postgresql18', table)).toThrow()
  const missing = tableFixture()
  missing.constraints.push({
    kind: 'primary_key',
    key: crypto.randomUUID(),
    name: 'pk',
    columns: [crypto.randomUUID()],
  })
  expect(() => assertTableDefinition('postgresql18', missing)).toThrow()
  expect(() =>
    assertTableDefinition('postgresql18', { ...tableFixture(), options: { strict: false } }),
  ).toThrow()
})
