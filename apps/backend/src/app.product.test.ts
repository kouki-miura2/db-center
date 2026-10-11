import { LIMITS, TERMS_VERSION } from 'utils'
import { beforeEach, describe, expect, test } from 'vite-plus/test'

import { createApp, SESSION_COOKIE } from './app.ts'
import { createConnectionMemoryDao } from './dao/connection.memory.ts'
import { createInvitationMemoryDao } from './dao/invitation.memory.ts'
import { createMemberMemoryDao } from './dao/member.memory.ts'
import { createMemoryDb, type MemoryDb, memoryTable } from './dao/memory-db.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './dao/product.memory.ts'
import type { UserRecord } from './dao/user.interface.ts'
import type { AuthGuard } from './repository/auth-guard.interface.ts'
import { createConnectionRepository } from './repository/connection.repository.ts'
import { createInvitationRepository } from './repository/invitation.repository.ts'
import { createMemberRepository } from './repository/member.repository.ts'
import { createProductRepository } from './repository/product.repository.ts'
import { createAesGcmSecretBox } from './repository/secret-box.aes-gcm.ts'
import type { AuthService } from './service/auth.service.ts'
import { createConnectionService } from './service/connection.service.ts'
import { createInvitationService } from './service/invitation.service.ts'
import { createMemberService } from './service/member.service.ts'
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
  const products = createProductRepository(createProductMemoryDao(db))
  const secrets = createAesGcmSecretBox(btoa('k'.repeat(32)))
  app = createApp({
    authService: {} as AuthService,
    productService: createProductService({ products }),
    connectionService: createConnectionService({
      products,
      connections: createConnectionRepository(createConnectionMemoryDao(db)),
      secrets,
    }),
    invitationService: createInvitationService({
      products,
      invitations: createInvitationRepository(createInvitationMemoryDao(db)),
      secrets,
    }),
    memberService: createMemberService({
      products,
      members: createMemberRepository(createMemberMemoryDao(db)),
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

describe('connections', () => {
  const setupProduct = async (target = 'postgresql18') => {
    const { body } = await createProduct('u1', `shop-${target}`, target)
    return body.product.id as string
  }
  const scopeOf = async (id: string, userId = 'u1') =>
    (await (await app.request(`/api/products/${id}`, as(userId))).json()).data

  test('adds a connection whose password never comes back', async () => {
    const id = await setupProduct()

    const res = await app.request(
      `/api/products/${id}/connections`,
      as('u1', 'POST', {
        name: '本番',
        connectionString: 'postgresql://app@db.example.com/ec',
        password: 'top-secret',
      }),
    )

    const body = await res.json()
    expect(body).toMatchObject({
      connection: { name: '本番', hasPassword: true, sortOrder: 1 },
      revisions: { product: 2 },
    })
    const scope = await scopeOf(id)
    expect(scope.connections).toEqual([body.connection])
    expect(JSON.stringify(scope)).not.toContain('top-secret')
    expect(JSON.stringify([...memoryTable(db, 'connections').values()])).not.toContain('top-secret')
    expect(JSON.stringify([...memoryTable(db, 'audit_logs').values()])).not.toContain('top-secret')
  })

  test('only owners and managers edit connections, and SQLite products have none', async () => {
    const id = await setupProduct()
    addMember(id, 'u2', 'member')
    const sqlite = await setupProduct('sqlite3')
    const add = (productId: string, userId: string) =>
      app.request(
        `/api/products/${productId}/connections`,
        as(userId, 'POST', { name: 'x', connectionString: 'postgresql://app@db/ec' }),
      )

    expect((await add(id, 'u2')).status).toBe(403)
    expect((await add(id, 'u3')).status).toBe(404)
    expect((await add(sqlite, 'u1')).status).toBe(409)
  })

  test('updates, reorders and deletes connections', async () => {
    const id = await setupProduct()
    const add = async (name: string) =>
      (
        await (
          await app.request(
            `/api/products/${id}/connections`,
            as('u1', 'POST', { name, connectionString: 'postgresql://app@db/ec', password: 'pw' }),
          )
        ).json()
      ).connection
    const first = await add('開発')
    const second = await add('本番')

    const updated = await app.request(
      `/api/products/${id}/connections/${first.id}`,
      as('u1', 'PATCH', {
        name: '開発2',
        connectionString: 'postgresql://app@db2/ec',
        password: null,
        expectedUpdatedAt: first.updatedAt,
      }),
    )
    expect(await updated.json()).toMatchObject({
      connection: { name: '開発2', hasPassword: false },
    })

    const { revision } = await (await app.request(`/api/products/${id}`, as('u1'))).json()
    const reordered = await app.request(
      `/api/products/${id}/connections/order`,
      as('u1', 'PUT', { connectionIds: [second.id, first.id], expectedRevision: revision }),
    )
    expect(reordered.status).toBe(200)
    expect((await scopeOf(id)).connections.map((c: { name: string }) => c.name)).toEqual([
      '本番',
      '開発2',
    ])

    const removed = await app.request(
      `/api/products/${id}/connections/${second.id}`,
      as('u1', 'DELETE', { expectedUpdatedAt: second.updatedAt }),
    )
    expect(removed.status).toBe(200)
    expect((await scopeOf(id)).connections).toHaveLength(1)
  })

  test('refuses a connection string with a password in it', async () => {
    const id = await setupProduct()

    const res = await app.request(
      `/api/products/${id}/connections`,
      as('u1', 'POST', { name: 'x', connectionString: 'postgresql://app:pw@db/ec' }),
    )

    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({
      error: { fields: { connectionString: expect.any(String) } },
    })
  })
})

describe('invitations', () => {
  const invite = (id: string, userId: string, invitees: { email: string; role: string }[]) =>
    app.request(`/api/products/${id}/invitations`, as(userId, 'POST', { invitees }))

  test('invites people with one passcode; the scope lists them without it', async () => {
    const { body } = await createProduct('u1', 'shop')
    const id = body.product.id

    const res = await invite(id, 'u1', [
      { email: 'Hanako@Example.com', role: 'manager' },
      { email: 'taro@example.com', role: 'member' },
    ])

    const result = await res.json()
    expect(result.passcode).toMatch(/^[A-Z0-9]{8}$/)
    expect(result.revisions).toEqual({ product: 2 })
    const scope = await (await app.request(`/api/products/${id}`, as('u1'))).json()
    expect(scope.data.invitations.map((i: { email: string }) => i.email)).toEqual([
      'hanako@example.com',
      'taro@example.com',
    ])
    expect(JSON.stringify(scope)).not.toContain(result.passcode)

    const shown = await app.request(
      `/api/products/${id}/invitations/${scope.data.invitations[1].id}/passcode`,
      as('u1', 'POST'),
    )
    expect(await shown.json()).toEqual({ passcode: result.passcode, expiresAt: result.expiresAt })
  })

  test('a manager invites members only; a member cannot invite', async () => {
    const { body } = await createProduct('u1', 'shop')
    const id = body.product.id
    addMember(id, 'u2', 'manager')
    addMember(id, 'u3', 'member')

    expect((await invite(id, 'u2', [{ email: 'a@example.com', role: 'manager' }])).status).toBe(403)
    expect((await invite(id, 'u2', [{ email: 'a@example.com', role: 'member' }])).status).toBe(200)
    expect((await invite(id, 'u3', [{ email: 'b@example.com', role: 'member' }])).status).toBe(403)
  })

  test('refuses to invite a member, and beyond the member limit', async () => {
    const { body } = await createProduct('u1', 'shop')
    const id = body.product.id

    expect((await invite(id, 'u1', [{ email: 'u1@example.com', role: 'member' }])).status).toBe(409)
    const many = Array.from({ length: LIMITS.membersPerProduct }, (_, i) => ({
      email: `p${i}@example.com`,
      role: 'member',
    }))
    const res = await invite(id, 'u1', many)
    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('limit_exceeded')
  })
})

describe('joining', () => {
  const inviteAndGetCode = async (email: string) => {
    const { body } = await createProduct('u1', `shop-${email}`)
    const res = await app.request(
      `/api/products/${body.product.id}/invitations`,
      as('u1', 'POST', { invitees: [{ email, role: 'member' }] }),
    )
    return { productId: body.product.id as string, passcode: (await res.json()).passcode as string }
  }
  const join = (userId: string, passcode: string) =>
    app.request('/api/invitations/join', as(userId, 'POST', { passcode }))

  test('the invited user joins with the code in any case, and sees the product', async () => {
    const { productId, passcode } = await inviteAndGetCode('u2@example.com')

    const res = await join('u2', passcode.toLowerCase())

    expect(await res.json()).toMatchObject({ product: { id: productId, role: 'member' } })
    const list = await (await app.request('/api/products', as('u2'))).json()
    expect(list.data.map((p: { id: string }) => p.id)).toEqual([productId])
    const scope = await (await app.request(`/api/products/${productId}`, as('u1'))).json()
    expect(scope.data.invitations).toEqual([])
    expect(scope.data.members.map((m: { userId: string }) => m.userId)).toEqual(['u1', 'u2'])
  })

  test('another account can’t use the code, and gets the same message as a wrong code', async () => {
    const { passcode } = await inviteAndGetCode('u2@example.com')

    const other = await (await join('u3', passcode)).json()
    const wrong = await (await join('u2', 'ZZZZ9999')).json()

    expect(other.error.message).toBe(
      'パスコードが正しくないか、このアカウント宛ての招待ではありません',
    )
    expect(wrong.error.message).toBe(other.error.message)
  })

  test(`refuses entry after ${LIMITS.passcodeFailures} failures, even with the right code`, async () => {
    const { passcode } = await inviteAndGetCode('u2@example.com')
    for (let i = 0; i < LIMITS.passcodeFailures; i++) {
      expect((await join('u2', 'ZZZZ9999')).status).toBe(400)
    }

    const res = await join('u2', passcode)

    expect(res.status).toBe(429)
  })
})

describe('members', () => {
  // Users get UUIDs here, since member routes take user IDs.
  const ids = {
    owner: crypto.randomUUID(),
    manager: crypto.randomUUID(),
    member: crypto.randomUUID(),
  }
  const arrange = async () => {
    for (const [name, id] of Object.entries(ids)) {
      memoryTable<UserRecord>(db, 'users').set(id, {
        id,
        googleSub: `sub-${id}`,
        email: `${name}@example.com`,
        name,
        termsVersion: TERMS_VERSION,
        agreedAt: 0,
        lastLoginAt: 0,
        productsRevision: 1,
        createdAt: 0,
        deletedAt: null,
      })
    }
    const { body } = await createProduct(ids.owner, 'shop')
    const productId = body.product.id as string
    addMember(productId, ids.manager, 'manager')
    addMember(productId, ids.member, 'member')
    return productId
  }
  const roleIn = async (productId: string, userId: string) =>
    (
      await (await app.request(`/api/products/${productId}`, as(ids.owner))).json()
    ).data.members.find((m: { userId: string }) => m.userId === userId)?.role ?? null

  test('a manager promotes a member, but only the owner demotes a manager', async () => {
    const productId = await arrange()
    const setRole = (userId: string, target: string, role: string) =>
      app.request(`/api/products/${productId}/members/${target}`, as(userId, 'PATCH', { role }))

    expect((await setRole(ids.manager, ids.member, 'manager')).status).toBe(200)
    expect(await roleIn(productId, ids.member)).toBe('manager')
    expect((await setRole(ids.manager, ids.member, 'member')).status).toBe(403)
    expect((await setRole(ids.owner, ids.member, 'member')).status).toBe(200)
  })

  test('the owner transfers ownership and becomes a manager', async () => {
    const productId = await arrange()

    const res = await app.request(
      `/api/products/${productId}/transfer-owner`,
      as(ids.owner, 'POST', { userId: ids.member }),
    )

    expect(res.status).toBe(200)
    expect(await roleIn(productId, ids.member)).toBe('owner')
    expect(await roleIn(productId, ids.owner)).toBe('manager')
  })

  test('removing and leaving take the product off the user’s list', async () => {
    const productId = await arrange()

    const removed = await app.request(
      `/api/products/${productId}/members/${ids.member}`,
      as(ids.manager, 'DELETE'),
    )
    expect(removed.status).toBe(200)
    expect((await (await app.request('/api/products', as(ids.member))).json()).data).toEqual([])

    expect(
      (await app.request(`/api/products/${productId}/leave`, as(ids.manager, 'POST'))).status,
    ).toBe(200)
    expect((await app.request(`/api/products/${productId}`, as(ids.manager))).status).toBe(404)
    expect(
      (await app.request(`/api/products/${productId}/leave`, as(ids.owner, 'POST'))).status,
    ).toBe(409)
  })
})
