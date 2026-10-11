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

  expect(await repository.findScope('p1')).toEqual({
    product,
    members: [{ userId: 'u1', name: 'はなこ', role: 'owner', joinedAt: 5 }],
  })
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
