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
  findProductsRevision: async () => 5,
  listForUser: async () => ({ revision: 5, memberships: [] }),
  create: async () => ({ productsRevision: 6 }),
  rename: async () => ({ product: product(), productsRevision: 6 }),
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
