import { PGlite } from '@electric-sql/pglite'
import { deploymentRecord } from 'backend/src/dao/deployment.contract.ts'
import { createDeploymentMemoryDao } from 'backend/src/dao/deployment.memory.ts'
import { createMemoryDb, memoryTable } from 'backend/src/dao/memory-db.ts'
import type { ConnectionRepository } from 'backend/src/repository/connection.repository.ts'
import { createDeploymentRepository } from 'backend/src/repository/deployment.repository.ts'
import type { ObjectRepository } from 'backend/src/repository/object.repository.ts'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema, sqlLiteral } from 'backend/src/service/ddl.ts'
import { createDeploymentExecutor } from 'backend/src/service/deployment-executor.service.ts'
import type { DeploymentPlan } from 'backend/src/service/deployment.service.ts'
import { designHash, hashText } from 'backend/src/service/drift.ts'
import { expect, test } from 'vite-plus/test'

import { testContext, testObject, testTable, testColumn, testSqlValidator } from './test-sql.ts'

export const executorFixture = async () => {
  const pg = new PGlite(),
    db = createMemoryDb(),
    context = testContext(),
    schema = testObject('schema', 'public', { owner: null, comment: null }),
    objects = [schema, testTable('items', schema.objectKey, [testColumn('id')])]
  const conn = {
    id: 'c1',
    productId: context.productId,
    name: 'test',
    connectionString: 'postgres://user@db.example.com/main',
    passwordEncrypted: null,
    sortOrder: 1,
    createdAt: 1000,
    updatedAt: 1000,
  }
  const r = {
    ...deploymentRecord(),
    productId: context.productId,
    databaseId: context.version.databaseId,
    toVersionId: context.version.id,
    phase: 'queued' as const,
    targetRevision: context.version.revision,
    connectionSnapshot: JSON.stringify(conn),
  }
  const generated = await generatePostgresDdl(
    context,
    objects,
    testSqlValidator,
    ddlOptionsSchema.parse({ versionTable: true }),
  )
  const setting = `SET dbcenter.deployment_id TO ${sqlLiteral(r.id)};`
  const plan: DeploymentPlan = {
    kind: 'build',
    databaseId: r.databaseId,
    productId: r.productId,
    target: {
      versionId: r.toVersionId,
      revision: r.targetRevision,
      designHash: await designHash(objects),
    },
    source: null,
    steps: [
      { objectKey: null, sql: setting, transactional: false, beforeTransaction: true },
      ...generated.steps,
    ],
    sql: setting + '\n\n' + generated.sql,
  }
  const encoded = JSON.stringify(plan)
  r.planHash = await hashText(encoded)
  memoryTable(db, 'deployments').set(r.id, r)
  memoryTable(db, 'databases').set(r.databaseId, { revision: 1 })
  memoryTable(db, 'products').set(r.productId, { revision: 1 })
  const saved = new Map([
      [`deployments/${r.id}.json`, encoded],
      [`deployments/${r.id}.sql`, plan.sql],
    ]),
    queries: string[] = []
  let failure: ((sql: string) => boolean) | undefined
  const repository = createDeploymentRepository(createDeploymentMemoryDao(db))
  const executor = createDeploymentExecutor({
    deployments: repository,
    storage: { putOnce: async () => {}, get: async (key) => saved.get(key) ?? null },
    connections: { findCredentials: async () => conn } as unknown as ConnectionRepository,
    objects: { findContext: async () => context } as unknown as ObjectRepository,
    secrets: { encrypt: async () => '', decrypt: async () => '' },
    postgres: {
      open: async () => ({
        query: async (sql, values) => {
          queries.push(sql)
          if (failure?.(sql)) throw new Error('raw password test-sensitive-value')
          const result = await pg.query<Record<string, unknown>>(sql, values)
          return { rows: result.rows, rowCount: result.affectedRows ?? 0 }
        },
        close: async () => {},
      }),
    },
  })
  return {
    pg,
    repository,
    executor,
    queries,
    r,
    context,
    objects,
    plan,
    saved,
    fail: (f: (sql: string) => boolean) => {
      failure = f
    },
  }
}
test(
  'asynchronous build applies PG18 transaction and records execution ID once',
  { timeout: 30_000 },
  async () => {
    const f = await executorFixture()
    try {
      expect(await f.executor.execute(f.r.id)).toMatchObject({ status: 'succeeded' })
      expect(
        (await f.pg.query<{ deployment_id: string }>('SELECT deployment_id FROM _dbcenter.version'))
          .rows[0]!.deployment_id,
      ).toBe(f.r.id)
      const previous = f.queries.length
      expect((await f.executor.execute(f.r.id)).status).toBe('not_claimed')
      expect(f.queries).toHaveLength(previous)
      expect((await f.repository.findById(f.r.id))!.executedCount).toBeGreaterThan(0)
    } finally {
      await f.pg.close()
    }
  },
)
test('checks empty database immediately before executing', { timeout: 30_000 }, async () => {
  const f = await executorFixture()
  try {
    await f.pg.exec('CREATE TABLE external_data(id integer)')
    expect((await f.executor.execute(f.r.id)).status).toBe('failed')
    expect(f.queries.some((q) => q.startsWith('CREATE TABLE "public"."items"'))).toBe(false)
  } finally {
    await f.pg.close()
  }
})
test(
  'transaction failure rolls back design and manager, retaining a safe failure position',
  { timeout: 30_000 },
  async () => {
    const f = await executorFixture()
    try {
      f.fail((sql) => sql.startsWith('COMMENT ON TABLE'))
      expect((await f.executor.execute(f.r.id)).status).toBe('failed')
      expect(
        (
          await f.pg.query<{ value: string | null }>(
            "SELECT to_regclass('public.items')::text value",
          )
        ).rows[0]!.value,
      ).toBeNull()
      const record = (await f.repository.findById(f.r.id))!
      expect(record.log).not.toContain('test-sensitive-value')
      expect(JSON.parse(record.log!)).toMatchObject({ committed: false, requiresInspection: true })
    } finally {
      await f.pg.close()
    }
  },
)
test(
  'corrupted immutable plan fails without opening the database',
  { timeout: 30_000 },
  async () => {
    const f = await executorFixture()
    try {
      f.saved.set(`deployments/${f.r.id}.json`, '{}')
      expect((await f.executor.execute(f.r.id)).status).toBe('failed')
      expect(f.queries).toHaveLength(0)
    } finally {
      await f.pg.close()
    }
  },
)
