import { createDeploymentMemoryDao } from 'backend/src/dao/deployment.memory.ts'
import { createMemoryDb, memoryTable } from 'backend/src/dao/memory-db.ts'
import { memberKey } from 'backend/src/dao/product.memory.ts'
import type { ConnectionRepository } from 'backend/src/repository/connection.repository.ts'
import { createDeploymentRepository } from 'backend/src/repository/deployment.repository.ts'
import type { ObjectRepository } from 'backend/src/repository/object.repository.ts'
import type { ProductRepository } from 'backend/src/repository/product.repository.ts'
import { createDeploymentService } from 'backend/src/service/deployment.service.ts'
import type { InspectionService } from 'backend/src/service/inspection.service.ts'
import { expect, test, vi } from 'vite-plus/test'

import { testContext, testObject, testSqlValidator } from './test-sql.ts'

test('receipt freezes SQL once, returns same receipt on resend and protects mismatched keys', async () => {
  const context = testContext(),
    objects = [testObject('schema', 'public', { owner: null, comment: null })],
    db = createMemoryDb()
  const connection = {
    id: crypto.randomUUID(),
    productId: context.productId,
    name: 'production',
    connectionString: 'postgres://user@db.example.com/main',
    passwordEncrypted: 'encrypted-test-value',
    sortOrder: 1,
    createdAt: 1000,
    updatedAt: 1000,
  }
  memoryTable(db, 'products').set(context.productId, {
    id: context.productId,
    revision: 1,
    deletedAt: null,
  })
  memoryTable(db, 'product_members').set(memberKey(context.productId, 'u1'), { role: 'owner' })
  memoryTable(db, 'databases').set(context.version.databaseId, {
    id: context.version.databaseId,
    productId: context.productId,
    revision: 1,
    deletedAt: null,
  })
  memoryTable(db, 'versions').set(context.version.id, context.version)
  memoryTable(db, 'connections').set(connection.id, connection)
  const saved = new Map<string, string>(),
    putOnce = vi.fn(async (key: string, value: string) => {
      if (saved.has(key)) throw new Error('overwrite')
      saved.set(key, value)
    }),
    start = vi.fn(async () => {})
  const deps = {
    products: {
      findMembership: async () => ({ role: 'owner', product: { target: 'postgresql18' } }),
    } as unknown as ProductRepository,
    connections: { findCredentials: async () => connection } as unknown as ConnectionRepository,
    objects: { findScope: async () => ({ context, objects }) } as unknown as ObjectRepository,
    deployments: createDeploymentRepository(createDeploymentMemoryDao(db)),
    sql: testSqlValidator,
    inspection: {
      inspect: async () => ({ supported: true, empty: true }),
    } as unknown as InspectionService,
    storage: {
      putOnce,
      get: async (key: string) => saved.get(key) ?? null,
      deleteAll: async () => {},
    },
    workflow: { start },
  }
  const service = createDeploymentService(deps),
    input = {
      userId: 'u1',
      connectionId: connection.id,
      kind: 'build' as const,
      toVersionId: context.version.id,
      expectedRevision: context.version.revision,
      idempotencyKey: crypto.randomUUID(),
    }
  const first = await service.accept(input)
  expect(first.phase).toBe('queued')
  expect(await service.accept(input)).toEqual(first)
  expect(putOnce).toHaveBeenCalledTimes(2)
  expect(start).toHaveBeenCalledOnce()
  expect(JSON.stringify(first)).not.toContain('encrypted-test-value')
  await expect(service.accept({ ...input, expectedRevision: 99 })).rejects.toMatchObject({
    code: 'invalid_state',
  })
  expect(
    (await createDeploymentService({ ...deps, storage: undefined }).preview(input)).reasons,
  ).toContain('not_configured')
  expect(
    (
      await createDeploymentService({
        ...deps,
        inspection: {
          inspect: async () => ({ supported: true, empty: false }),
        } as unknown as InspectionService,
      }).preview(input)
    ).canExecute,
  ).toBe(false)
})
