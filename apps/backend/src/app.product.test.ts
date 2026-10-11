import { LIMITS, TERMS_VERSION } from 'utils'
import { beforeEach, expect, test } from 'vite-plus/test'

import { createApp, SESSION_COOKIE } from './app.ts'
import { createMemoryDb, type MemoryDb, memoryTable } from './dao/memory-db.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './dao/product.memory.ts'
import type { UserRecord } from './dao/user.interface.ts'
import type { AuthGuard } from './repository/auth-guard.interface.ts'
import { createProductRepository } from './repository/product.repository.ts'
import type { AuthService } from './service/auth.service.ts'
import { createProductService } from './service/product.service.ts'

// The product routes over the real service and in-memory DAO. Requests act as the user named in
// the `x-test-user` header, so one test can play several users.

let db: MemoryDb
let app: ReturnType<typeof createApp>

const headerGuard: AuthGuard = {
  authenticate: async (request) => {
    const id = request.headers.get('x-test-user')
    return id
      ? { id, name: id, email: `${id}@example.com`, termsVersion: TERMS_VERSION, sessionId: 's' }
      : null
  },
}

beforeEach(() => {
  db = createMemoryDb()
  for (const id of ['u1', 'u2', 'u3']) {
    memoryTable<UserRecord>(db, 'users').set(id, {
      id,
      googleSub: `sub-${id}`,
      email: `${id}@example.com`,
      name: id,
      termsVersion: TERMS_VERSION,
      agreedAt: 0,
      lastLoginAt: 0,
      productsRevision: 1,
      createdAt: 0,
      deletedAt: null,
    })
  }
  app = createApp({
    authService: {} as AuthService,
    productService: createProductService({
      products: createProductRepository(createProductMemoryDao(db)),
    }),
    auth: { guard: headerGuard, enabled: true, excludePaths: [] },
    sessionCookie: SESSION_COOKIE.production,
    devLogin: false,
  })
})

const as = (userId: string, method = 'GET', body?: unknown): RequestInit => ({
  method,
  headers: {
    'x-test-user': userId,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

const createProduct = async (userId: string, name: string, target = 'postgresql18') => {
  const res = await app.request('/api/products', as(userId, 'POST', { name, target }))
  return { res, body: await res.json() }
}

const addMember = (productId: string, userId: string, role: MemberRow['role']) =>
  memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
    productId,
    userId,
    role,
    joinedAt: 0,
  })

test('creates a product and lists it for its owner', async () => {
  const { res, body } = await createProduct('u1', 'ec-shop')

  expect(res.status).toBe(200)
  expect(body).toMatchObject({
    product: { name: 'ec-shop', target: 'postgresql18', role: 'owner' },
    revisions: { products: 2 },
  })
  const list = await (await app.request('/api/products', as('u1'))).json()
  expect(list).toMatchObject({ mode: 'full', revision: 2, data: [{ name: 'ec-shop' }] })
  expect(memoryTable(db, 'audit_logs').size).toBe(1)
})

test('answers unchanged for a current revision, and full for an older one', async () => {
  await createProduct('u1', 'ec-shop')

  expect(await (await app.request('/api/products?revision=2', as('u1'))).json()).toEqual({
    mode: 'unchanged',
    revision: 2,
  })
  expect(await (await app.request('/api/products?revision=1', as('u1'))).json()).toMatchObject({
    mode: 'full',
  })
})

test('lists only the products the user belongs to', async () => {
  await createProduct('u1', 'mine')
  await createProduct('u2', 'theirs')

  const list = await (await app.request('/api/products', as('u1'))).json()

  expect(list.data.map((item: { name: string }) => item.name)).toEqual(['mine'])
})

test('refuses a duplicate name for the same owner only', async () => {
  await createProduct('u1', 'shop')

  expect((await createProduct('u1', 'shop')).res.status).toBe(409)
  expect((await createProduct('u2', 'shop')).res.status).toBe(200)
})

test(`refuses a product beyond the limit of ${LIMITS.productsPerUser}`, async () => {
  for (let i = 0; i < LIMITS.productsPerUser; i++) await createProduct('u1', `p${i}`)

  const { res, body } = await createProduct('u1', 'one-too-many')

  expect(res.status).toBe(409)
  expect(body.error.code).toBe('limit_exceeded')
})

test.each([
  ['an empty name', { name: '  ', target: 'postgresql18' }],
  [
    'a name over the limit',
    { name: 'x'.repeat(LIMITS.productNameMaxLength + 1), target: 'sqlite3' },
  ],
  ['an unknown target', { name: 'shop', target: 'mysql8' }],
])('refuses %s', async (_, body) => {
  expect((await app.request('/api/products', as('u1', 'POST', body))).status).toBe(400)
})

test('renames with the latest updatedAt, and refuses a stale one', async () => {
  const { body } = await createProduct('u1', 'shop')
  const { id, updatedAt } = body.product

  const renamed = await app.request(
    `/api/products/${id}`,
    as('u1', 'PATCH', { name: 'shop2', expectedUpdatedAt: updatedAt }),
  )
  expect(await renamed.json()).toMatchObject({
    product: { name: 'shop2' },
    revisions: { products: 3, product: 2 },
  })

  const stale = await app.request(
    `/api/products/${id}`,
    as('u1', 'PATCH', { name: 'shop3', expectedUpdatedAt: updatedAt }),
  )
  expect(stale.status).toBe(409)
  expect(await stale.json()).toMatchObject({
    error: { code: 'stale_update', message: '他のユーザーが更新しました。再読み込みしてください' },
  })
})

test('lets a manager rename, but not a member; a non-member gets 404', async () => {
  const { body } = await createProduct('u1', 'shop')
  const { id, updatedAt } = body.product
  addMember(id, 'u2', 'member')
  const rename = (userId: string) =>
    app.request(
      `/api/products/${id}`,
      as(userId, 'PATCH', { name: 'x', expectedUpdatedAt: updatedAt }),
    )

  expect((await rename('u2')).status).toBe(403)
  expect((await rename('u3')).status).toBe(404)
  addMember(id, 'u2', 'manager')
  expect((await rename('u2')).status).toBe(200)
})

test('renaming bumps every member’s list revision', async () => {
  const { body } = await createProduct('u1', 'shop')
  addMember(body.product.id, 'u2', 'member')

  await app.request(
    `/api/products/${body.product.id}`,
    as('u1', 'PATCH', { name: 'shop2', expectedUpdatedAt: body.product.updatedAt }),
  )

  const list = await (await app.request('/api/products?revision=1', as('u2'))).json()
  expect(list).toMatchObject({
    mode: 'full',
    revision: 2,
    data: [{ name: 'shop2', role: 'member' }],
  })
})

test('a malformed product ID is a 400', async () => {
  const res = await app.request(
    '/api/products/nope',
    as('u1', 'PATCH', { name: 'x', expectedUpdatedAt: 1 }),
  )

  expect(res.status).toBe(400)
})

test('returns the product scope to members only', async () => {
  const { body } = await createProduct('u1', 'shop')
  const { id } = body.product
  addMember(id, 'u2', 'member')

  const scope = await (await app.request(`/api/products/${id}`, as('u2'))).json()

  expect(scope).toMatchObject({
    mode: 'full',
    revision: 1,
    data: {
      product: { id, name: 'shop', target: 'postgresql18' },
      role: 'member',
      members: [
        { userId: 'u1', name: 'u1', role: 'owner' },
        { userId: 'u2', name: 'u2', role: 'member' },
      ],
    },
  })
  expect((await app.request(`/api/products/${id}`, as('u3'))).status).toBe(404)
  expect((await app.request(`/api/products/${crypto.randomUUID()}`, as('u1'))).status).toBe(404)
})

test('answers the product scope unchanged for its current revision', async () => {
  const { body } = await createProduct('u1', 'shop')

  expect(
    await (await app.request(`/api/products/${body.product.id}?revision=1`, as('u1'))).json(),
  ).toEqual({ mode: 'unchanged', revision: 1 })
})

test('a deleted product is gone from its scope', async () => {
  const { body } = await createProduct('u1', 'shop')
  const product = memoryTable<{ deletedAt: number | null }>(db, 'products').get(body.product.id)
  if (product) product.deletedAt = Date.now()

  expect((await app.request(`/api/products/${body.product.id}`, as('u1'))).status).toBe(404)
})

test('the owner deletes a product after typing its name; it is gone for everyone', async () => {
  const { body } = await createProduct('u1', 'shop')
  const { id, updatedAt } = body.product
  addMember(id, 'u2', 'manager')
  const remove = (userId: string, confirmationName: string) =>
    app.request(
      `/api/products/${id}`,
      as(userId, 'DELETE', { confirmationName, expectedUpdatedAt: updatedAt }),
    )

  expect((await remove('u2', 'shop')).status).toBe(403)
  expect((await remove('u1', 'shop?')).status).toBe(400)
  const deleted = await remove('u1', 'shop')
  expect(await deleted.json()).toEqual({ revisions: { products: 3 } })

  expect((await app.request(`/api/products/${id}`, as('u2'))).status).toBe(404)
  const list = await (await app.request('/api/products', as('u2'))).json()
  expect(list.data).toEqual([])
  // Its name is free again.
  expect((await createProduct('u1', 'shop')).res.status).toBe(200)
})
