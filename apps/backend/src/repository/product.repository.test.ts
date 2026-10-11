import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { ProductDao, ProductRecord } from '../dao/product.interface.ts'
import { createProductRepository } from './product.repository.ts'

const record: ProductRecord = {
  id: 'p1',
  name: 'shop',
  target: 'postgresql18',
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
  deletedAt: null,
}
const audit = {} as AuditLogRecord

const created: Parameters<ProductDao['create']>[0][] = []
const fakeDao: ProductDao = {
  findMembership: async () => ({ product: record, role: 'manager', joinedAt: 5 }),
  findScope: async () => ({
    product: record,
    members: [{ userId: 'u1', name: 'はなこ', role: 'owner', joinedAt: 5 }],
    connections: [
      {
        id: 'c1',
        productId: 'p1',
        name: '本番',
        connectionString: 'postgresql://app@db/ec',
        passwordEncrypted: 'v1.cipher',
        sortOrder: 1,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
    invitations: [],
    databases: [
      {
        database: {
          id: 'd1',
          productId: 'p1',
          name: 'ec_main',
          description: null,
          createdAt: 1,
          updatedAt: 1,
          revision: 1,
          deletedAt: null,
        },
        latestVersion: { id: 'v1', number: 1, status: 'editing', schemaCount: 1, tableCount: 0 },
        latestFinalVersion: null,
      },
    ],
  }),
  findProductsRevision: async () => 7,
  listForUser: async () => ({
    revision: 7,
    memberships: [{ product: record, role: 'owner', joinedAt: 5 }],
  }),
  create: async (input) => {
    created.push(input)
    return { productsRevision: 8 }
  },
  rename: async () => ({ product: { ...record, name: 'renamed' }, productsRevision: 9 }),
  delete: async () => ({ productsRevision: 10 }),
}

const product = {
  id: 'p1',
  name: 'shop',
  target: 'postgresql18',
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
} as const

test('maps a membership without the storage-only deletedAt', async () => {
  const repository = createProductRepository(fakeDao)

  expect(await repository.findMembership('p1', 'u1')).toEqual({
    product,
    role: 'manager',
    joinedAt: 5,
  })
  expect(await repository.listForUser('u1')).toEqual({
    revision: 7,
    memberships: [{ product, role: 'owner', joinedAt: 5 }],
  })
})

test('maps the product scope', async () => {
  const repository = createProductRepository(fakeDao)

  const scope = await repository.findScope('p1')
  expect(scope).toMatchObject({
    product,
    members: [{ userId: 'u1', name: 'はなこ', role: 'owner', joinedAt: 5 }],
    connections: [{ id: 'c1', hasPassword: true }],
  })
  expect(scope?.databases[0]?.database).not.toHaveProperty('deletedAt')
  expect(JSON.stringify(scope)).not.toContain('cipher')
})

test('stores a new product as not deleted', async () => {
  const repository = createProductRepository(fakeDao)

  await repository.create({ product, ownerId: 'u1', maxProducts: 20, audit })

  expect(created[0]?.product).toEqual({ ...product, deletedAt: null })
})

test('returns the renamed product in the domain shape', async () => {
  const repository = createProductRepository(fakeDao)

  expect(
    await repository.rename({
      productId: 'p1',
      name: 'renamed',
      expectedUpdatedAt: 2,
      now: 3,
      userId: 'u1',
      allowedRoles: ['owner'],
      audit,
    }),
  ).toEqual({ product: { ...product, name: 'renamed' }, productsRevision: 9 })
})
