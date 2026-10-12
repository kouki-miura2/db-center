import { expect, test } from 'vite-plus/test'

import { postgresConstraint, postgresIndex } from './ddl-postgres.ts'
import {
  assertTableDefinition,
  assertSequence,
  objectInputSchema,
  sequenceDefinitionSchema,
  tableDefinitionSchema,
} from './definition.ts'

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

test('SQLite strict types and PostgreSQL-only options are rejected', () => {
  const table = tableFixture()
  table.options = { strict: true }
  expect(() => assertTableDefinition('sqlite3', table)).toThrow()
  table.columns[0]!.dataType = 'INTEGER'
  expect(() => assertTableDefinition('sqlite3', table)).not.toThrow()
  table.options.fillfactor = 90
  expect(() => assertTableDefinition('sqlite3', table)).toThrow()
})
test('sequences keep 64-bit precision and validate bounds', () => {
  const value = sequenceDefinitionSchema.parse({
    dataType: 'bigint',
    start: '9223372036854775806',
    increment: '1',
    min: null,
    max: null,
    cache: '1',
    cycle: false,
    ownedBy: null,
    comment: null,
  })
  expect(() => assertSequence(value)).not.toThrow()
  expect(() => assertSequence({ ...value, increment: '0' })).toThrow()
  expect(() => assertSequence({ ...value, dataType: 'smallint' })).toThrow()
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
test('EXCLUDE and index operator classes are persisted and rendered only on PostgreSQL', () => {
  const table = tableFixture(),
    column = table.columns[0]!
  const constraint = {
    key: crypto.randomUUID(),
    name: 'no_overlap',
    kind: 'exclude' as const,
    method: 'gist' as const,
    elements: [{ columnKey: column.key, expression: null, operator: '=' }],
    where: null,
    deferrable: true,
    initiallyDeferred: false,
  }
  table.constraints.push(constraint)
  table.indexes.push({
    key: crypto.randomUUID(),
    name: 'idx',
    method: 'btree',
    columns: [
      {
        columnKey: column.key,
        expression: null,
        order: 'DESC',
        nulls: 'LAST',
        operatorClass: 'pg_catalog.int8_ops',
      },
    ],
    include: [],
    where: null,
    unique: false,
    fillfactor: null,
    concurrently: false,
  })
  expect(() => assertTableDefinition('postgresql18', table)).not.toThrow()
  expect(() => assertTableDefinition('sqlite3', table)).toThrow()
  expect(postgresConstraint(constraint, table, [])).toContain(
    'EXCLUDE USING gist ("id" WITH =) DEFERRABLE INITIALLY IMMEDIATE',
  )
  const objects = [
    {
      id: 's',
      objectKey: 's',
      versionId: 'v',
      schemaKey: null,
      kind: 'schema' as const,
      name: 'public',
      logicalName: null,
      definition: {},
      updatedAt: 1,
      updatedBy: 'u',
      revision: 1,
      deletedAt: null,
    },
  ]
  const object = {
    ...objects[0]!,
    id: 't',
    objectKey: 't',
    kind: 'table' as const,
    schemaKey: 's',
    name: 't',
    definition: table,
  }
  expect(postgresIndex(object, table.indexes[0]!, objects)).toContain(
    '"pg_catalog"."int8_ops" DESC NULLS LAST',
  )
})
