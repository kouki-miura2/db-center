import { PGlite } from '@electric-sql/pglite'
import { deploymentRecord } from 'backend/src/dao/deployment.contract.ts'
import { createDeploymentMemoryDao } from 'backend/src/dao/deployment.memory.ts'
import { createMemoryDb, memoryTable } from 'backend/src/dao/memory-db.ts'
import { memberKey } from 'backend/src/dao/product.memory.ts'
import type { ConnectionRepository } from 'backend/src/repository/connection.repository.ts'
import { createDeploymentRepository } from 'backend/src/repository/deployment.repository.ts'
import type { ObjectRepository } from 'backend/src/repository/object.repository.ts'
import { readPostgresCatalog } from 'backend/src/repository/postgres-catalog.ts'
import { inspectPostgres, type PgSession } from 'backend/src/repository/postgres.interface.ts'
import type { ProductRepository } from 'backend/src/repository/product.repository.ts'
import { generatePostgresDdl } from 'backend/src/service/ddl-postgres.ts'
import { ddlOptionsSchema, sqlLiteral } from 'backend/src/service/ddl.ts'
import type { TableDefinition } from 'backend/src/service/definition.ts'
import { createDeploymentExecutor } from 'backend/src/service/deployment-executor.service.ts'
import type { DeploymentPlan } from 'backend/src/service/deployment.service.ts'
import { createDeploymentService } from 'backend/src/service/deployment.service.ts'
import { designHash, hashText } from 'backend/src/service/drift.ts'
import type { InspectionService } from 'backend/src/service/inspection.service.ts'
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
  memoryTable(db, 'databases').set(r.databaseId, {
    id: r.databaseId,
    productId: r.productId,
    deletedAt: null,
    revision: 1,
  })
  memoryTable(db, 'products').set(r.productId, { id: r.productId, deletedAt: null, revision: 1 })
  memoryTable(db, 'connections').set(conn.id, conn)
  memoryTable(db, 'versions').set(context.version.id, context.version)
  memoryTable(db, 'product_members').set(memberKey(r.productId, 'u1'), { role: 'owner' })
  const contexts = new Map([[context.version.id, context]]),
    designs = new Map([[context.version.id, objects]])
  const objectRepository = {
    findContext: async (id: string) => contexts.get(id) ?? null,
    findScope: async (id: string) => {
      const c = contexts.get(id)
      return c ? { context: c, objects: designs.get(id)! } : null
    },
  } as unknown as ObjectRepository
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
    objects: objectRepository,
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
    contexts,
    designs,
    db,
    conn,
    objectRepository,
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

const migrationFixture = async () => {
  const f = await executorFixture()
  expect((await f.executor.execute(f.r.id)).status).toBe('succeeded')
  const target = {
    ...f.context,
    version: { ...f.context.version, id: crypto.randomUUID(), number: 2 },
  }
  const objects = structuredClone(f.objects)
  ;(objects[1]!.definition as TableDefinition).columns.push(
    testColumn('note', { dataType: 'text' }),
  )
  f.contexts.set(target.version.id, target)
  f.designs.set(target.version.id, objects)
  memoryTable(f.db, 'versions').set(target.version.id, target.version)
  const session: PgSession = {
    query: async (sql, values) => {
      const r = await f.pg.query<Record<string, unknown>>(sql, values)
      return { rows: r.rows, rowCount: r.affectedRows ?? 0 }
    },
    close: async () => {},
  }
  const service = createDeploymentService({
    products: {
      findMembership: async () => ({ role: 'owner', product: { target: 'postgresql18' } }),
    } as unknown as ProductRepository,
    connections: { findCredentials: async () => f.conn } as unknown as ConnectionRepository,
    objects: f.objectRepository,
    sql: testSqlValidator,
    deployments: f.repository,
    storage: {
      putOnce: async (key, value) => {
        if (f.saved.has(key)) throw new Error('overwrite')
        f.saved.set(key, value)
      },
      get: async (key) => f.saved.get(key) ?? null,
    },
    workflow: { start: async () => {} },
    inspection: {
      inspect: async () => ({
        ...(await inspectPostgres(session)),
        catalog: await readPostgresCatalog(session),
      }),
    } as unknown as InspectionService,
  })
  const input = {
    userId: 'u1',
    connectionId: f.conn.id,
    kind: 'migration' as const,
    fromVersionId: f.context.version.id,
    toVersionId: target.version.id,
    expectedRevision: target.version.revision,
    idempotencyKey: crypto.randomUUID(),
  }
  return { ...f, target, targetObjects: objects, service, input }
}
test(
  'a migration with no physical changes still advances the applied version',
  { timeout: 30_000 },
  async () => {
    const f = await migrationFixture()
    try {
      ;(f.targetObjects[1]!.definition as TableDefinition).columns.pop()
      const receipt = await f.service.accept(f.input)
      expect((await f.executor.execute(receipt.id)).status).toBe('succeeded')
      expect(
        (await f.pg.query<{ version_id: string }>('SELECT version_id FROM _dbcenter.version'))
          .rows[0]!.version_id,
      ).toBe(f.target.version.id)
    } finally {
      await f.pg.close()
    }
  },
)
test(
  'migration receipt and execution preserve data and advance the actual manager',
  { timeout: 30_000 },
  async () => {
    const f = await migrationFixture()
    try {
      await f.pg.exec('INSERT INTO items(id) VALUES(7)')
      expect((await f.service.preview(f.input)).canExecute).toBe(true)
      const receipt = await f.service.accept(f.input)
      expect((await f.executor.execute(receipt.id)).status).toBe('succeeded')
      expect((await f.pg.query('SELECT id,note FROM items')).rows).toEqual([{ id: 7, note: null }])
      expect(
        (
          await f.pg.query<{ version_id: string; deployment_id: string }>(
            'SELECT version_id,deployment_id FROM _dbcenter.version',
          )
        ).rows[0],
      ).toEqual({ version_id: f.target.version.id, deployment_id: receipt.id })
    } finally {
      await f.pg.close()
    }
  },
)
test.each(['mismatch', 'drift', 'data_loss'] as const)(
  'rejects unsafe %s during migration receipt',
  { timeout: 30_000 },
  async (reason) => {
    const f = await migrationFixture()
    try {
      if (reason === 'mismatch') await f.pg.exec('UPDATE _dbcenter.version SET revision=999')
      if (reason === 'drift') await f.pg.exec('ALTER TABLE items ADD COLUMN external_data text')
      if (reason === 'data_loss') f.targetObjects.splice(1, 1)
      const preview = await f.service.preview(f.input)
      expect(preview.canExecute).toBe(false)
      expect(preview.reasons).toContain(
        reason === 'mismatch'
          ? 'applied_version_mismatch'
          : reason === 'drift'
            ? 'drift_detected'
            : 'data_loss',
      )
      await expect(f.service.accept(f.input)).rejects.toMatchObject({ code: 'invalid_state' })
      expect(await f.repository.list(f.r.databaseId)).toHaveLength(1)
    } finally {
      await f.pg.close()
    }
  },
)
test.each(['drift', 'mismatch'] as const)(
  'rechecks %s after receipt before executing DDL',
  { timeout: 30_000 },
  async (reason) => {
    const f = await migrationFixture()
    try {
      const receipt = await f.service.accept(f.input)
      await f.pg.exec(
        reason === 'drift'
          ? 'ALTER TABLE items ADD COLUMN external_data text'
          : 'UPDATE _dbcenter.version SET revision=999',
      )
      expect((await f.executor.execute(receipt.id)).status).toBe('failed')
      expect(JSON.parse((await f.repository.findById(receipt.id))!.log!)).toMatchObject({
        precheckReasons: [reason === 'drift' ? 'drift_detected' : 'applied_version_mismatch'],
        committed: false,
      })
      expect(
        (await f.pg.query<{ version_id: string }>('SELECT version_id FROM _dbcenter.version'))
          .rows[0]!.version_id,
      ).toBe(f.context.version.id)
    } finally {
      await f.pg.close()
    }
  },
)
test(
  'outside failure retains committed position, does not advance version and cannot replay',
  { timeout: 30_000 },
  async () => {
    const f = await migrationFixture()
    try {
      const table = f.targetObjects[1]!.definition as TableDefinition
      table.indexes.push({
        key: crypto.randomUUID(),
        name: 'note_idx',
        method: 'btree',
        unique: false,
        columns: [
          { columnKey: table.columns[1]!.key, expression: null, order: 'ASC', nulls: null },
        ],
        include: [],
        where: null,
        fillfactor: null,
        concurrently: true,
      })
      const receipt = await f.service.accept(f.input)
      f.fail((sql) => sql.startsWith('CREATE INDEX CONCURRENTLY'))
      expect((await f.executor.execute(receipt.id)).status).toBe('failed')
      const record = (await f.repository.findById(receipt.id))!
      expect(JSON.parse(record.log!)).toMatchObject({
        committed: true,
        lastStep: { phase: 'outside', status: 'running' },
        requiresInspection: true,
      })
      expect(
        (await f.pg.query<{ version_id: string }>('SELECT version_id FROM _dbcenter.version'))
          .rows[0]!.version_id,
      ).toBe(f.context.version.id)
      expect((await f.executor.execute(receipt.id)).status).toBe('not_claimed')
    } finally {
      await f.pg.close()
    }
  },
)
