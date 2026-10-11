import { LIMITS } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import { AppError } from '../error.ts'
import type { Membership, Product, ProductRepository } from '../repository/product.repository.ts'
import { createProductService } from './product.service.ts'

const product = (overrides: Partial<Product> = {}): Product => ({
  id: 'p1',
  name: 'shop',
  target: 'postgresql18',
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
  ...overrides,
})

// A hand-written ProductRepository; tests replace only the methods they exercise.
const fakeProducts = (overrides: Partial<ProductRepository> = {}): ProductRepository => ({
  findMembership: async () => null,
  findScope: async () => null,
  findProductsRevision: async () => 5,
  listForUser: async () => ({ revision: 5, memberships: [] }),
  create: async () => ({ productsRevision: 6 }),
  rename: async () => ({ product: product(), productsRevision: 6 }),
  delete: async () => ({ productsRevision: 6 }),
  ...overrides,
})

const membership = (role: Membership['role'], overrides: Partial<Product> = {}): Membership => ({
  product: product(overrides),
  role,
  joinedAt: 4,
})

test('answers unchanged without reading the list when the client is current', async () => {
  const listForUser = vi.fn()
  const service = createProductService({ products: fakeProducts({ listForUser }) })

  expect(await service.listProducts('u1', 5)).toEqual({ mode: 'unchanged', revision: 5 })
  expect(listForUser).not.toHaveBeenCalled()
})

test('returns the whole list, by name, when the client is out of date', async () => {
  const service = createProductService({
    products: fakeProducts({
      listForUser: async () => ({
        revision: 5,
        memberships: [
          membership('member', { id: 'p2', name: 'web' }),
          membership('owner', { id: 'p1', name: 'api' }),
        ],
      }),
    }),
  })

  const result = await service.listProducts('u1', 4)

  expect(result).toMatchObject({ mode: 'full', revision: 5 })
  if (result.mode !== 'full') throw new Error('expected full')
  expect(result.data.map((item) => [item.name, item.role])).toEqual([
    ['api', 'owner'],
    ['web', 'member'],
  ])
})

test('creates a product owned by the user, with an audit log entry', async () => {
  const create = vi.fn<ProductRepository['create']>(async () => ({ productsRevision: 6 }))
  const service = createProductService({ products: fakeProducts({ create }) })

  const result = await service.createProduct({ userId: 'u1', name: 'shop', target: 'sqlite3' })

  expect(result).toMatchObject({
    product: { name: 'shop', target: 'sqlite3', role: 'owner' },
    revisions: { products: 6 },
  })
  const input = create.mock.calls[0]?.[0]
  expect(input).toMatchObject({ ownerId: 'u1', maxProducts: LIMITS.productsPerUser })
  expect(input?.audit).toMatchObject({
    productId: result.product.id,
    userId: 'u1',
    targetType: 'product',
    action: 'create',
    summary: 'shop',
  })
})

test.each([
  ['duplicate', '同じ名前のプロダクトがすでにあります'],
  ['limit_exceeded', `参加できるプロダクトは${LIMITS.productsPerUser}件までです`],
] as const)('explains a %s conflict', async (code, message) => {
  const service = createProductService({
    products: fakeProducts({
      create: async () => {
        throw new AppError(code)
      },
    }),
  })

  await expect(
    service.createProduct({ userId: 'u1', name: 'shop', target: 'sqlite3' }),
  ).rejects.toMatchObject({ code, message })
})

test('renames for a manager, passing the allowed roles and the old and new names to the log', async () => {
  const rename = vi.fn<ProductRepository['rename']>(async () => ({
    product: product({ name: 'shop2', revision: 4 }),
    productsRevision: 6,
  }))
  const service = createProductService({
    products: fakeProducts({ findMembership: async () => membership('manager'), rename }),
  })

  const result = await service.renameProduct({
    userId: 'u1',
    productId: 'p1',
    name: 'shop2',
    expectedUpdatedAt: 2,
  })

  expect(result).toMatchObject({
    product: { name: 'shop2' },
    revisions: { products: 6, product: 4 },
  })
  expect(rename.mock.calls[0]?.[0]).toMatchObject({
    allowedRoles: ['owner', 'manager'],
    expectedUpdatedAt: 2,
    audit: { action: 'update', summary: 'shop → shop2' },
  })
})

test('refuses a member renaming, and hides the product from a non-member', async () => {
  const rename = vi.fn()
  const asMember = createProductService({
    products: fakeProducts({ findMembership: async () => membership('member'), rename }),
  })
  const asStranger = createProductService({ products: fakeProducts({ rename }) })
  const input = { userId: 'u1', productId: 'p1', name: 'x', expectedUpdatedAt: 2 }

  await expect(asMember.renameProduct(input)).rejects.toMatchObject({ code: 'forbidden' })
  await expect(asStranger.renameProduct(input)).rejects.toMatchObject({ code: 'not_found' })
  expect(rename).not.toHaveBeenCalled()
})

test('answers the product scope unchanged from the membership read alone', async () => {
  const findScope = vi.fn()
  const service = createProductService({
    products: fakeProducts({ findMembership: async () => membership('member'), findScope }),
  })

  expect(await service.getProduct({ userId: 'u1', productId: 'p1', clientRevision: 3 })).toEqual({
    mode: 'unchanged',
    revision: 3,
  })
  expect(findScope).not.toHaveBeenCalled()
})

test('returns the whole product scope: role, members by role and name, valid invitations', async () => {
  const service = createProductService({
    products: fakeProducts({
      findMembership: async () => membership('manager'),
      findScope: async () => ({
        product: product({ revision: 4 }),
        members: [
          { userId: 'u3', name: 'c', role: 'member', joinedAt: 1 },
          { userId: 'u2', name: 'b', role: 'manager', joinedAt: 3 },
          { userId: 'u1', name: 'a', role: 'owner', joinedAt: 2 },
          { userId: 'u4', name: 'd', role: 'manager', joinedAt: 2 },
        ],
        connections: [],
        invitations: [
          {
            id: 'i2',
            email: 'z@example.com',
            role: 'member',
            expiresAt: Date.now() + 1000,
            createdAt: 1,
          },
          {
            id: 'i3',
            email: 'old@example.com',
            role: 'member',
            expiresAt: Date.now() - 1,
            createdAt: 1,
          },
          {
            id: 'i1',
            email: 'a@example.com',
            role: 'manager',
            expiresAt: Date.now() + 1000,
            createdAt: 1,
          },
        ],
      }),
    }),
  })

  // The client holds revision 2; the product is at 3 (membership) and 4 by the time it's read.
  const result = await service.getProduct({ userId: 'u2', productId: 'p1', clientRevision: 2 })

  expect(result).toMatchObject({ mode: 'full', revision: 4, data: { role: 'manager' } })
  if (result.mode !== 'full') throw new Error('expected full')
  // By role, then by name (b before d), not by join date.
  expect(result.data.members.map((m) => m.userId)).toEqual(['u1', 'u2', 'u4', 'u3'])
  // Valid invitations only, by email.
  expect(result.data.invitations.map((i) => i.id)).toEqual(['i1', 'i2'])
})

test('hides the product scope from a non-member', async () => {
  const service = createProductService({ products: fakeProducts() })

  await expect(service.getProduct({ userId: 'u9', productId: 'p1' })).rejects.toMatchObject({
    code: 'not_found',
  })
})

test('deletes a product for its owner once the name is confirmed', async () => {
  const remove = vi.fn<ProductRepository['delete']>(async () => ({ productsRevision: 7 }))
  const service = createProductService({
    products: fakeProducts({ findMembership: async () => membership('owner'), delete: remove }),
  })

  expect(
    await service.deleteProduct({
      userId: 'u1',
      productId: 'p1',
      confirmationName: 'shop',
      expectedUpdatedAt: 2,
    }),
  ).toEqual({ revisions: { products: 7 } })
  expect(remove.mock.calls[0]?.[0]).toMatchObject({
    allowedRoles: ['owner'],
    expectedUpdatedAt: 2,
    audit: { action: 'delete', summary: 'shop' },
  })
})

test('refuses to delete without the exact name, or as a manager', async () => {
  const remove = vi.fn()
  const input = { userId: 'u1', productId: 'p1', confirmationName: 'shop', expectedUpdatedAt: 2 }
  const asOwner = createProductService({
    products: fakeProducts({ findMembership: async () => membership('owner'), delete: remove }),
  })
  const asManager = createProductService({
    products: fakeProducts({ findMembership: async () => membership('manager'), delete: remove }),
  })

  await expect(asOwner.deleteProduct({ ...input, confirmationName: 'Shop' })).rejects.toMatchObject(
    {
      code: 'invalid_input',
      fields: { confirmationName: '名前が一致しません' },
    },
  )
  await expect(asManager.deleteProduct(input)).rejects.toMatchObject({ code: 'forbidden' })
  expect(remove).not.toHaveBeenCalled()
})
