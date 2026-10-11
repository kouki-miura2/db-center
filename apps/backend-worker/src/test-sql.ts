import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import type { PGlite } from '@electric-sql/pglite'
import type { VersionContext } from 'backend/src/dao/object.interface.ts'
import type { DesignObject } from 'backend/src/repository/object.repository.ts'
import type { SqlStep } from 'backend/src/service/ddl.ts'
import {
  tableDefinitionSchema,
  type DesignColumn,
  type TableDefinition,
} from 'backend/src/service/definition.ts'

import { createSqlValidator } from './sql-validator.ts'

/** Each planned statement is its own protocol command, like psql executing a script file. */
export const applyPostgresSteps = async (db: PGlite, steps: SqlStep[], transaction = true) => {
  for (const step of steps.filter((v) => v.beforeTransaction)) await db.exec(step.sql)
  const inside = steps.filter((v) => v.transactional && !v.beforeTransaction)
  if (transaction && inside.length) await db.exec('BEGIN;')
  try {
    for (const step of inside) await db.exec(step.sql)
    if (transaction && inside.length) await db.exec('COMMIT;')
  } catch (error) {
    if (transaction && inside.length) await db.exec('ROLLBACK;')
    throw error
  }
  for (const step of steps.filter((v) => !v.transactional && !v.beforeTransaction))
    await db.exec(step.sql)
}

const require = createRequire(import.meta.url)
const Module = WebAssembly.Module as unknown as new (bytes: Uint8Array) => WebAssembly.Module
export const testSqlValidator = createSqlValidator({
  pg: new Module(readFileSync(require.resolve('libpg-query/wasm/libpg-query.wasm'))),
  sqlite: new Module(readFileSync(require.resolve('sql.js/dist/sql-wasm.wasm'))),
})
export const testContext = (target: VersionContext['target'] = 'postgresql18'): VersionContext => ({
  productId: crypto.randomUUID(),
  databaseName: 'main',
  target,
  version: {
    id: crypto.randomUUID(),
    databaseId: crypto.randomUUID(),
    number: 1,
    status: 'final',
    sourceVersionId: null,
    memo: null,
    provisionalAt: 1,
    finalizedAt: 2,
    createdAt: 0,
    updatedAt: 2,
    revision: 3,
    compactedRevision: 3,
    schemaCount: 1,
    tableCount: 0,
    definitionBytes: 0,
  },
})
export const testColumn = (name: string, overrides: Partial<DesignColumn> = {}): DesignColumn => ({
  key: crypto.randomUUID(),
  name,
  logicalName: name,
  dataType: 'integer',
  notNull: false,
  defaultValue: null,
  comment: null,
  generation: null,
  collation: null,
  ...overrides,
})
export const testObject = (
  kind: DesignObject['kind'],
  name: string,
  definition: unknown,
  schemaKey: string | null = null,
): DesignObject => ({
  id: crypto.randomUUID(),
  objectKey: crypto.randomUUID(),
  versionId: 'v',
  kind,
  name,
  schemaKey,
  logicalName: name,
  definition,
  updatedBy: 'u',
  updatedAt: 1,
  revision: 1,
  deletedAt: null,
})
export const testTable = (
  name: string,
  schemaKey: string | null,
  columns: DesignColumn[],
  overrides: Partial<TableDefinition> = {},
) =>
  testObject(
    'table',
    name,
    tableDefinitionSchema.parse({
      columns,
      constraints: [
        {
          key: crypto.randomUUID(),
          kind: 'primary_key',
          name: `${name}_pk`,
          columns: [columns[0]!.key],
        },
      ],
      indexes: [],
      size: null,
      options: {},
      ...overrides,
    }),
    schemaKey,
  )
