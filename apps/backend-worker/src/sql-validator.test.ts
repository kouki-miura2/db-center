import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { DesignObject } from 'backend/src/repository/object.repository.ts'
import { expect, test } from 'vite-plus/test'

import { createSqlValidator } from './sql-validator.ts'

const require = createRequire(import.meta.url)
const Module = WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module
const validator = createSqlValidator({
  pg: new Module(readFileSync(require.resolve('libpg-query/wasm/libpg-query.wasm'))),
  sqlite: new Module(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))),
})
const objects: DesignObject[] = [
  {
    id: 'o',
    versionId: 'v',
    objectKey: 't',
    kind: 'table',
    schemaKey: null,
    name: 'orders',
    logicalName: null,
    definition: { columns: [{ name: 'id' }, { name: 'price' }] },
    updatedBy: 'u',
    updatedAt: 1,
    revision: 1,
    deletedAt: null,
  },
]

test.each(['postgresql18', 'sqlite3'] as const)(
  '%s validates actual SQL syntax and column references',
  async (target) => {
    expect(
      (
        await validator.validateView(
          target,
          'SELECT o.id, o.price AS total FROM orders o',
          objects,
          null,
        )
      ).columns,
    ).toEqual(['id', 'total'])
    await expect(
      validator.validateView(target, 'SELECT missing FROM orders', objects, null),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      validator.validateView(target, 'SELECT * FROM nowhere', objects, null),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      validator.validateView(target, 'SELECT FROM', objects, null),
    ).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(
      validator.validateView(target, 'SELECT 1; DELETE FROM orders', objects, null),
    ).rejects.toMatchObject({ code: 'invalid_input' })
  },
)
test('PostgreSQL scopes CTEs, aliases and nested queries, rejecting writes and ambiguous columns', async () => {
  expect(
    (
      await validator.validateView(
        'postgresql18',
        'WITH x AS (SELECT id FROM orders) SELECT x.id FROM x',
        objects,
        null,
      )
    ).columns,
  ).toEqual(['id'])
  expect(
    (await validator.validateView('postgresql18', 'SELECT $$paid$$ AS status', objects, null))
      .columns,
  ).toEqual(['status'])
  await expect(
    validator.validateView(
      'postgresql18',
      'SELECT id FROM orders a JOIN orders b ON a.id=b.id',
      objects,
      null,
    ),
  ).rejects.toThrow()
  await expect(
    validator.validateView('postgresql18', 'SELECT id INTO x FROM orders', objects, null),
  ).rejects.toThrow()
  await expect(
    validator.validateView('postgresql18', 'SELECT id FROM orders FOR UPDATE', objects, null),
  ).rejects.toThrow()
  await expect(
    validator.validateView(
      'postgresql18',
      'WITH x AS (DELETE FROM orders RETURNING id) SELECT id FROM x',
      objects,
      null,
    ),
  ).rejects.toThrow()
})
test('expressions and types reject SQL injection', async () => {
  await validator.validateExpression('postgresql18', 'id > 0', ['id'])
  await validator.validateDataType('postgresql18', 'numeric(10,2)')
  await expect(
    validator.validateExpression('postgresql18', '1); DROP TABLE orders; SELECT (1', []),
  ).rejects.toThrow()
  await expect(
    validator.validateDataType('postgresql18', 'bigint, injected text'),
  ).rejects.toThrow()
})
