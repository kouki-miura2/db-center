import { LIMITS } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import { AppError } from '../error.ts'
import type { Database, DatabaseRepository } from '../repository/database.repository.ts'
import type { Membership, ProductRepository } from '../repository/product.repository.ts'
import { createDatabaseService } from './database.service.ts'

const membership = (
  role: Membership['role'],
  target: Membership['product']['target'] = 'postgresql18',
): Membership => ({
  product: { id: 'p1', name: 'shop', target, createdAt: 1, updatedAt: 1, revision: 3 },
  role,
  joinedAt: 1,
})

const products = (found: Membership | null) =>
  ({ findMembership: async () => found }) as unknown as ProductRepository

const database: Database = {
  id: 'd1',
  productId: 'p1',
  name: 'ec_main',
  description: '基幹',
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
}

const fakeDatabases = (overrides: Partial<DatabaseRepository> = {}): DatabaseRepository => ({
  findById: async () => database,
  create: async () => ({ productRevision: 4 }),
  update: async () => ({ database: { ...database, name: 'renamed' }, productRevision: 4 }),
  delete: async () => ({ productRevision: 4 }),
  ...overrides,
})

const service = (
  role: Membership['role'] | null,
  databases = fakeDatabases(),
  target?: 'sqlite3',
) =>
  createDatabaseService({
    products: products(role ? membership(role, target) : null),
    databases,
  })

test('creates v1 (editing) with the public schema on PostgreSQL 18', async () => {
  const create = vi.fn<DatabaseRepository['create']>(async () => ({ productRevision: 4 }))

  const result = await service('manager', fakeDatabases({ create })).createDatabase({
    userId: 'u1',
    productId: 'p1',
    name: 'ec_main',
    description: '',
  })

  const input = create.mock.calls[0]?.[0]
  expect(input).toMatchObject({
    database: { productId: 'p1', name: 'ec_main', description: null, revision: 1 },
    schema: { name: 'public', definition: '{}' },
    maxDatabases: LIMITS.databasesPerProduct,
    allowedRoles: ['owner', 'manager'],
    audit: { targetType: 'database', action: 'create', summary: 'ec_main' },
  })
  expect(result).toEqual({
    database: {
      id: input?.database.id,
      name: 'ec_main',
      description: null,
      createdAt: expect.any(Number),
      updatedAt: input?.database.createdAt,
      latestVersion: { id: input?.versionId, number: 1, status: 'editing' },
      latestFinalVersion: null,
      schemaCount: 1,
      tableCount: 0,
    },
    revisions: { product: 4 },
  })
})

test('creates no schema on SQLite 3', async () => {
  const create = vi.fn<DatabaseRepository['create']>(async () => ({ productRevision: 4 }))

  const result = await service('owner', fakeDatabases({ create }), 'sqlite3').createDatabase({
    userId: 'u1',
    productId: 'p1',
    name: 'app',
    description: 'アプリ',
  })

  expect(create.mock.calls[0]?.[0]).toMatchObject({
    schema: null,
    database: { description: 'アプリ' },
  })
  expect(result.database.schemaCount).toBe(0)
})

test('a member may not create, rename or delete; a non-member gets not_found', async () => {
  const create = vi.fn()
  const member = service('member', fakeDatabases({ create }))
  const input = { userId: 'u1', productId: 'p1', databaseId: 'd1', expectedUpdatedAt: 2 }

  await expect(
    member.createDatabase({ ...input, name: 'x', description: '' }),
  ).rejects.toMatchObject({ code: 'forbidden' })
  await expect(
    member.updateDatabase({ ...input, name: 'x', description: '' }),
  ).rejects.toMatchObject({ code: 'forbidden' })
  await expect(
    member.deleteDatabase({ ...input, confirmationName: 'ec_main' }),
  ).rejects.toMatchObject({ code: 'forbidden' })
  await expect(
    service(null).createDatabase({ ...input, name: 'x', description: '' }),
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(create).not.toHaveBeenCalled()
})

test('rewords a duplicate name and the limit', async () => {
  const failing = (code: 'duplicate' | 'limit_exceeded') =>
    service(
      'owner',
      fakeDatabases({
        create: async () => {
          throw new AppError(code)
        },
      }),
    ).createDatabase({ userId: 'u1', productId: 'p1', name: 'x', description: '' })

  await expect(failing('duplicate')).rejects.toMatchObject({
    code: 'duplicate',
    message: '同じ名前のデータベースがすでにあります',
  })
  await expect(failing('limit_exceeded')).rejects.toMatchObject({
    code: 'limit_exceeded',
    message: `データベースは${LIMITS.databasesPerProduct}件までです`,
  })
})

test('renames with optimistic locking and logs old → new', async () => {
  const update = vi.fn<DatabaseRepository['update']>(async () => ({
    database: { ...database, name: 'renamed', revision: 4 },
    productRevision: 5,
  }))

  const result = await service('manager', fakeDatabases({ update })).updateDatabase({
    userId: 'u1',
    productId: 'p1',
    databaseId: 'd1',
    name: 'renamed',
    description: '',
    expectedUpdatedAt: 2,
  })

  expect(update.mock.calls[0]?.[0]).toMatchObject({
    name: 'renamed',
    description: null,
    expectedUpdatedAt: 2,
    audit: { action: 'update', summary: 'ec_main → renamed' },
  })
  expect(result).toEqual({
    database: { id: 'd1', name: 'renamed', description: '基幹', createdAt: 1, updatedAt: 2 },
    revisions: { product: 5, database: 4 },
  })
})

test('an unknown or deleted database is not_found', async () => {
  const missing = service('owner', fakeDatabases({ findById: async () => null }))
  const input = { userId: 'u1', productId: 'p1', databaseId: 'd9', expectedUpdatedAt: 2 }

  await expect(
    missing.updateDatabase({ ...input, name: 'x', description: '' }),
  ).rejects.toMatchObject({ code: 'not_found' })
  await expect(missing.deleteDatabase({ ...input, confirmationName: 'x' })).rejects.toMatchObject({
    code: 'not_found',
  })
})

test('deletes only when the typed name matches', async () => {
  const remove = vi.fn<DatabaseRepository['delete']>(async () => ({ productRevision: 6 }))
  const owner = service('owner', fakeDatabases({ delete: remove }))
  const input = { userId: 'u1', productId: 'p1', databaseId: 'd1', expectedUpdatedAt: 2 }

  await expect(owner.deleteDatabase({ ...input, confirmationName: 'ec' })).rejects.toMatchObject({
    code: 'invalid_input',
  })
  expect(remove).not.toHaveBeenCalled()

  expect(await owner.deleteDatabase({ ...input, confirmationName: 'ec_main' })).toEqual({
    revisions: { product: 6 },
  })
  expect(remove.mock.calls[0]?.[0]).toMatchObject({
    expectedUpdatedAt: 2,
    audit: { action: 'delete', summary: 'ec_main' },
  })
})
