import { LIMITS, TERMS_VERSION } from 'utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { createApp, SESSION_COOKIE } from './app.ts'
import { createAuditLogMemoryDao } from './dao/audit-log.memory.ts'
import { createConnectionMemoryDao } from './dao/connection.memory.ts'
import { createDatabaseMemoryDao } from './dao/database.memory.ts'
import { createInvitationMemoryDao } from './dao/invitation.memory.ts'
import { createMemberMemoryDao } from './dao/member.memory.ts'
import { createMemoryDb, type MemoryDb, memoryTable } from './dao/memory-db.ts'
import { createObjectMemoryDao } from './dao/object.memory.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './dao/product.memory.ts'
import { createRevisionMemoryDao } from './dao/revision.memory.ts'
import type { UserRecord } from './dao/user.interface.ts'
import { createVersionMemoryDao } from './dao/version.memory.ts'
import { createAuditLogRepository } from './repository/audit-log.repository.ts'
import type { AuthGuard } from './repository/auth-guard.interface.ts'
import { createConnectionRepository } from './repository/connection.repository.ts'
import { createDatabaseRepository } from './repository/database.repository.ts'
import { createInvitationRepository } from './repository/invitation.repository.ts'
import { createMemberRepository } from './repository/member.repository.ts'
import { createObjectRepository } from './repository/object.repository.ts'
import { createProductRepository } from './repository/product.repository.ts'
import { createRevisionRepository } from './repository/revision.repository.ts'
import { createAesGcmSecretBox } from './repository/secret-box.aes-gcm.ts'
import { createVersionRepository } from './repository/version.repository.ts'
import { createAuditLogService } from './service/audit-log.service.ts'
import type { AuthService } from './service/auth.service.ts'
import { createConnectionService } from './service/connection.service.ts'
import { createDatabaseService } from './service/database.service.ts'
import type { TableDefinition } from './service/definition.ts'
import { createInvitationService } from './service/invitation.service.ts'
import { createMemberService } from './service/member.service.ts'
import { createObjectService } from './service/object.service.ts'
import { createProductService } from './service/product.service.ts'
import { createRevisionService } from './service/revision.service.ts'
import { createVersionService } from './service/version.service.ts'

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
    databaseService: createDatabaseService({
      products,
      databases: createDatabaseRepository(createDatabaseMemoryDao(db)),
    }),
    objectService: createObjectService({
      products,
      objects: createObjectRepository(createObjectMemoryDao(db)),
    }),
    versionService: createVersionService({
      products,
      databases: createDatabaseRepository(createDatabaseMemoryDao(db)),
      objects: createObjectRepository(createObjectMemoryDao(db)),
      versions: createVersionRepository(createVersionMemoryDao(db)),
      sql: {
        validateView: async () => ({ columns: [], dependencies: [] }),
        validateExpression: async () => {},
        validateDataType: async () => {},
      },
    }),
    revisionService: createRevisionService({
      revisions: createRevisionRepository(createRevisionMemoryDao(db)),
    }),
    auditLogService: createAuditLogService({
      products,
      auditLogs: createAuditLogRepository(createAuditLogMemoryDao(db)),
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

afterEach(() => vi.restoreAllMocks())

describe('audit log', () => {
  test('members read the log newest first, then only what’s new', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000)
    const { body } = await createProduct('u1', 'shop')
    const { id, updatedAt } = body.product
    addMember(id, 'u2', 'member')
    clock.mockReturnValue(2000)
    await app.request(
      `/api/products/${id}`,
      as('u1', 'PATCH', { name: 'shop2', expectedUpdatedAt: updatedAt }),
    )

    const log = await (await app.request(`/api/products/${id}/audit-logs`, as('u2'))).json()

    expect(
      log.entries.map((e: { action: string; summary: string }) => [e.action, e.summary]),
    ).toEqual([
      ['update', 'shop → shop2'],
      ['create', 'shop'],
    ])
    expect(log.entries[0]).toMatchObject({ userId: 'u1', userName: 'u1', targetType: 'product' })
    expect(log.nextBefore).toBeNull()

    const latest = log.entries[0].cursor
    const nothingNew = await (
      await app.request(`/api/products/${id}/audit-logs?after=${latest}`, as('u2'))
    ).json()
    expect(nothingNew.entries).toEqual([])
    expect((await app.request(`/api/products/${id}/audit-logs`, as('u3'))).status).toBe(404)
  })
})

describe('databases', () => {
  const arrange = async (target = 'postgresql18') => {
    const { body } = await createProduct('u1', 'shop', target)
    addMember(body.product.id, 'u2', 'member')
    return body.product.id as string
  }
  const createDatabase = (productId: string, body: unknown, userId = 'u1') =>
    app.request(`/api/products/${productId}/databases`, as(userId, 'POST', body))
  const scope = async (productId: string, userId = 'u1') =>
    (await app.request(`/api/products/${productId}`, as(userId))).json()

  test('creates an empty database listed in the product scope, bumping its revision', async () => {
    const productId = await arrange()

    const res = await createDatabase(productId, { name: 'ec_main', description: '基幹' })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      database: {
        name: 'ec_main',
        description: '基幹',
        latestVersion: { number: 1, status: 'editing' },
        latestFinalVersion: null,
        schemaCount: 1,
        tableCount: 0,
      },
      revisions: { product: 2 },
    })
    const product = await scope(productId, 'u2')
    expect(product).toMatchObject({ revision: 2, data: { databases: [body.database] } })
    expect(memoryTable(db, 'objects').size).toBe(1)
  })

  test('lists databases by name; SQLite 3 starts without a schema', async () => {
    const productId = await arrange('sqlite3')
    await createDatabase(productId, { name: 'zeta' })
    await createDatabase(productId, { name: 'alpha' })

    const { data } = await scope(productId)

    expect(data.databases.map((d: { name: string }) => d.name)).toEqual(['alpha', 'zeta'])
    expect(data.databases[0]).toMatchObject({ description: null, schemaCount: 0 })
  })

  test.each(['', 'Ec', '1db', 'ec-main', 'a'.repeat(64)])(
    'refuses the database name %j',
    async (name) => {
      const productId = await arrange()

      const res = await createDatabase(productId, { name })

      expect(res.status).toBe(400)
      expect((await res.json()).error.fields).toHaveProperty('name')
    },
  )

  test('refuses a description over the limit and unknown fields', async () => {
    const productId = await arrange()

    const tooLong = 'あ'.repeat(LIMITS.databaseDescriptionMaxLength + 1)
    expect((await createDatabase(productId, { name: 'ok', description: tooLong })).status).toBe(400)
    expect((await createDatabase(productId, { name: 'ok', target: 'x' })).status).toBe(400)
  })

  test('refuses a name in use, but not one of a deleted database', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()

    expect((await createDatabase(productId, { name: 'main' })).status).toBe(409)
    const removed = await app.request(
      `/api/products/${productId}/databases/${database.id}`,
      as('u1', 'DELETE', { confirmationName: 'main', expectedUpdatedAt: database.updatedAt }),
    )
    expect(removed.status).toBe(200)
    expect((await createDatabase(productId, { name: 'main' })).status).toBe(200)
  })

  test(`refuses a database beyond the limit of ${LIMITS.databasesPerProduct}`, async () => {
    const productId = await arrange()
    for (let i = 0; i < LIMITS.databasesPerProduct; i += 1) {
      expect((await createDatabase(productId, { name: `db${i}` })).status).toBe(200)
    }

    const res = await createDatabase(productId, { name: 'one_more' })

    expect(res.status).toBe(409)
    expect((await res.json()).error.code).toBe('limit_exceeded')
  })

  test('a member can’t create, rename or delete; an outsider gets 404', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const path = `/api/products/${productId}/databases/${database.id}`

    expect((await createDatabase(productId, { name: 'x' }, 'u2')).status).toBe(403)
    expect(
      (
        await app.request(
          path,
          as('u2', 'PATCH', { name: 'x', description: '', expectedUpdatedAt: database.updatedAt }),
        )
      ).status,
    ).toBe(403)
    expect(
      (
        await app.request(
          path,
          as('u2', 'DELETE', { confirmationName: 'main', expectedUpdatedAt: database.updatedAt }),
        )
      ).status,
    ).toBe(403)
    expect((await createDatabase(productId, { name: 'x' }, 'u3')).status).toBe(404)
  })

  test('renames with optimistic locking, bumping the product and database revisions', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const rename = (name: string, expectedUpdatedAt: number) =>
      app.request(
        `/api/products/${productId}/databases/${database.id}`,
        as('u1', 'PATCH', { name, description: '新しい説明', expectedUpdatedAt }),
      )

    const res = await rename('renamed', database.updatedAt)

    expect(await res.json()).toMatchObject({
      database: { id: database.id, name: 'renamed', description: '新しい説明' },
      revisions: { product: 3, database: 2 },
    })
    const stale = await rename('again', database.updatedAt)
    expect(stale.status).toBe(409)
    expect((await stale.json()).error.code).toBe('stale_update')
    expect((await scope(productId)).data.databases[0].name).toBe('renamed')
  })

  test('deleting needs the name typed again; the database then disappears', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const path = `/api/products/${productId}/databases/${database.id}`
    const remove = (confirmationName: string) =>
      app.request(
        path,
        as('u1', 'DELETE', { confirmationName, expectedUpdatedAt: database.updatedAt }),
      )

    expect((await remove('mai')).status).toBe(400)
    expect(await (await remove('main')).json()).toEqual({ revisions: { product: 3 } })
    expect((await scope(productId)).data.databases).toEqual([])
    expect((await remove('main')).status).toBe(404)
  })

  test('reads the database scope: versions and common columns, unchanged when current', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const path = `/api/products/${productId}/databases/${database.id}`

    const full = await (await app.request(path, as('u2'))).json()

    expect(full).toEqual({
      mode: 'full',
      revision: 1,
      data: {
        database: {
          id: database.id,
          name: 'main',
          description: null,
          createdAt: database.createdAt,
          updatedAt: database.updatedAt,
        },
        commonColumns: [],
        versions: [
          {
            id: database.latestVersion.id,
            number: 1,
            status: 'editing',
            sourceVersionId: null,
            memo: null,
            provisionalAt: null,
            finalizedAt: null,
            createdAt: database.createdAt,
            updatedAt: database.createdAt,
            schemaCount: 1,
            tableCount: 0,
          },
        ],
      },
    })
    expect(await (await app.request(`${path}?revision=1`, as('u2'))).json()).toEqual({
      mode: 'unchanged',
      revision: 1,
    })
    expect((await app.request(path, as('u3'))).status).toBe(404)
  })

  test('a deleted database’s scope is 404', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const path = `/api/products/${productId}/databases/${database.id}`
    await app.request(
      path,
      as('u1', 'DELETE', { confirmationName: 'main', expectedUpdatedAt: database.updatedAt }),
    )

    expect((await app.request(path, as('u1'))).status).toBe(404)
    expect((await app.request(`${path}?revision=2`, as('u1'))).status).toBe(404)
  })

  describe('common columns', () => {
    const createdAt = {
      name: 'created_at',
      logicalName: '登録日時',
      dataType: 'timestamptz',
      notNull: true,
      defaultValue: 'now()',
      comment: null,
      generation: null,
      collation: null,
    }

    test('any member saves the set; only the database revision grows', async () => {
      const productId = await arrange()
      const { database } = await (await createDatabase(productId, { name: 'main' })).json()
      const path = `/api/products/${productId}/databases/${database.id}`
      const productRevision = (await scope(productId)).revision

      const res = await app.request(
        `${path}/common-columns`,
        as('u2', 'PUT', { columns: [createdAt], expectedRevision: 1 }),
      )

      expect(await res.json()).toEqual({
        commonColumns: [createdAt],
        revisions: { database: 2 },
      })
      const databaseScope = await (await app.request(path, as('u1'))).json()
      expect(databaseScope).toMatchObject({
        revision: 2,
        data: { commonColumns: [createdAt], database: { updatedAt: database.updatedAt } },
      })
      expect((await scope(productId)).revision).toBe(productRevision)
      expect(
        await (
          await app.request(`/api/products/${productId}?revision=${productRevision}`, as('u1'))
        ).json(),
      ).toEqual({ mode: 'unchanged', revision: productRevision })
    })

    test('refuses a stale revision, bad columns and outsiders', async () => {
      const productId = await arrange()
      const { database } = await (await createDatabase(productId, { name: 'main' })).json()
      const save = (userId: string, body: unknown) =>
        app.request(
          `/api/products/${productId}/databases/${database.id}/common-columns`,
          as(userId, 'PUT', body),
        )

      const stale = await save('u1', { columns: [], expectedRevision: 2 })
      expect(stale.status).toBe(409)
      expect((await stale.json()).error.code).toBe('stale_update')

      const duplicate = await save('u1', { columns: [createdAt, createdAt], expectedRevision: 1 })
      expect(duplicate.status).toBe(400)
      expect((await duplicate.json()).error.fields).toHaveProperty(['columns.1.name'])

      const unknownField = await save('u1', {
        columns: [{ ...createdAt, extra: true }],
        expectedRevision: 1,
      })
      expect(unknownField.status).toBe(400)

      const tooMany = Array.from({ length: LIMITS.columnsPerTable + 1 }, (_, i) => ({
        ...createdAt,
        name: `c${i}`,
      }))
      expect((await save('u1', { columns: tooMany, expectedRevision: 1 })).status).toBe(400)

      expect((await save('u3', { columns: [], expectedRevision: 1 })).status).toBe(404)
    })
  })

  test('a deleted product’s database can’t be reached by its ID', async () => {
    const productId = await arrange()
    const { database } = await (await createDatabase(productId, { name: 'main' })).json()
    const product = memoryTable<{ deletedAt: number | null }>(db, 'products').get(productId)
    if (product) product.deletedAt = Date.now()

    const path = `/api/products/${productId}/databases/${database.id}`
    const res = await app.request(
      path,
      as('u1', 'PATCH', { name: 'x', description: '', expectedUpdatedAt: database.updatedAt }),
    )

    expect(res.status).toBe(404)
    expect((await app.request(path, as('u1'))).status).toBe(404)
  })
})

describe('revision check', () => {
  const check = (userId: string, body: unknown) =>
    app.request('/api/revisions/check', as(userId, 'POST', body))

  test('returns the revisions of the user’s own scopes, leaving out the rest', async () => {
    const { body: mine } = await createProduct('u1', 'mine')
    const { body: theirs } = await createProduct('u2', 'theirs')
    const created = await app.request(
      `/api/products/${mine.product.id}/databases`,
      as('u1', 'POST', { name: 'main' }),
    )
    const { database } = await created.json()
    const scopes = {
      productIds: [mine.product.id, theirs.product.id],
      databaseIds: [database.id, crypto.randomUUID()],
      versionIds: [database.latestVersion.id],
    }

    const res = await check('u1', { productList: true, ...scopes })

    expect(await res.json()).toEqual({
      productList: 2,
      products: { [mine.product.id]: 2 },
      databases: { [database.id]: 1 },
      versions: { [database.latestVersion.id]: 1 },
    })
    const outsider = await check('u3', { productList: false, ...scopes })
    expect(await outsider.json()).toEqual({
      productList: null,
      products: {},
      databases: {},
      versions: {},
    })
  })

  test(`refuses more than ${LIMITS.revisionCheckScopes} scopes and malformed IDs`, async () => {
    const ids = (n: number) => Array.from({ length: n }, () => crypto.randomUUID())
    const request = (productIds: string[], databaseIds: string[]) =>
      check('u1', { productList: false, productIds, databaseIds, versionIds: [] })

    expect((await request(ids(LIMITS.revisionCheckScopes), ids(1))).status).toBe(400)
    expect((await request(ids(LIMITS.revisionCheckScopes), [])).status).toBe(200)
    expect((await request(['x'], [])).status).toBe(400)
  })
})

test('object routes isolate products, lock each object and return deletion deltas', async () => {
  const { body: product } = await createProduct('u1', 'design')
  const { database } = await (
    await app.request(
      `/api/products/${product.product.id}/databases`,
      as('u1', 'POST', { name: 'main' }),
    )
  ).json()
  const path = `/api/versions/${database.latestVersion.id}`
  const initial = await (await app.request(path, as('u1'))).json()
  const input = {
    kind: 'table',
    name: 'orders',
    logicalName: null,
    schemaKey: initial.data.objects[0].objectKey,
    definition: {
      columns: [],
      constraints: [] as TableDefinition['constraints'],
      indexes: [],
      size: null,
      options: {},
    },
  }
  expect((await app.request(path, as('u3'))).status).toBe(404)
  const created = await app.request(`${path}/objects`, as('u1', 'POST', input))
  expect(created.status).toBe(200)
  const result = await created.json()
  const objectPath = `${path}/objects/${result.object.objectKey}`
  const saved = await app.request(
    objectPath,
    as('u1', 'PUT', { input, expectedUpdatedAt: result.object.updatedAt }),
  )
  const current = await saved.json()
  expect(saved.status).toBe(200)
  expect(
    (
      await app.request(
        objectPath,
        as('u1', 'PUT', { input, expectedUpdatedAt: result.object.updatedAt }),
      )
    ).status,
  ).toBe(409)
  expect(
    (
      await app.request(
        objectPath,
        as('u1', 'DELETE', {
          confirmationName: 'wrong',
          expectedUpdatedAt: current.object.updatedAt,
        }),
      )
    ).status,
  ).toBe(400)
  expect(
    (
      await app.request(
        objectPath,
        as('u1', 'DELETE', {
          confirmationName: 'orders',
          expectedUpdatedAt: current.object.updatedAt,
        }),
      )
    ).status,
  ).toBe(200)
  const delta = await (
    await app.request(`${path}?revision=${current.revisions.version}`, as('u1'))
  ).json()
  expect(delta.mode).toBe('delta')
  expect(delta.deletedKeys).toEqual([result.object.objectKey])
  expect(
    (await (await app.request(`${path}?revision=${delta.revision}`, as('u1'))).json()).mode,
  ).toBe('unchanged')
})

test('database cloning accepts only an accessible final source and preserves design keys', async () => {
  const { body } = await createProduct('u1', 'clone-product')
  const productId = body.product.id
  addMember(productId, 'u2', 'member')
  const path = `/api/products/${productId}/databases`
  const source = (await (await app.request(path, as('u1', 'POST', { name: 'source' }))).json())
    .database
  const sourceVersionId = source.latestVersion.id
  const versionPath = `/api/versions/${sourceVersionId}`
  expect(
    (await app.request(path, as('u1', 'POST', { name: 'editing_clone', sourceVersionId }))).status,
  ).toBe(409)
  const initial = (await (await app.request(versionPath, as('u1'))).json()).data
  const p = await (
    await app.request(
      `${versionPath}/provisional`,
      as('u1', 'POST', {
        expectedUpdatedAt: initial.version.updatedAt,
        expectedRevision: initial.version.revision,
      }),
    )
  ).json()
  expect(
    (await app.request(path, as('u1', 'POST', { name: 'provisional_clone', sourceVersionId })))
      .status,
  ).toBe(409)
  await app.request(
    `${versionPath}/finalize`,
    as('u1', 'POST', {
      expectedUpdatedAt: p.version.updatedAt,
      expectedRevision: p.version.revision,
    }),
  )
  expect(
    (await app.request(path, as('u2', 'POST', { name: 'member_clone', sourceVersionId }))).status,
  ).toBe(403)
  const clonedResponse = await app.request(
    path,
    as('u1', 'POST', { name: 'copy', sourceVersionId }),
  )
  expect(clonedResponse.status).toBe(200)
  const cloned = await clonedResponse.json()
  expect(cloned.database).toMatchObject({
    schemaCount: 1,
    tableCount: 0,
    latestVersion: { number: 1, status: 'editing' },
    latestFinalVersion: null,
  })
  const copied = (
    await (await app.request(`/api/versions/${cloned.database.latestVersion.id}`, as('u1'))).json()
  ).data
  expect(copied.version.sourceVersionId).toBeNull()
  expect(copied.objects[0].objectKey).toBe(initial.objects[0].objectKey)
  expect(copied.objects[0].id).not.toBe(initial.objects[0].id)
  const { body: other } = await createProduct('u1', 'other-product')
  expect(
    (
      await app.request(
        `/api/products/${other.product.id}/databases`,
        as('u1', 'POST', { name: 'external', sourceVersionId }),
      )
    ).status,
  ).toBe(404)
  const dbScope = (await (await app.request(`${path}/${source.id}`, as('u1'))).json()).data
  await app.request(
    `${path}/${source.id}`,
    as('u1', 'DELETE', {
      confirmationName: 'source',
      expectedUpdatedAt: dbScope.database.updatedAt,
    }),
  )
  expect(
    (await app.request(path, as('u1', 'POST', { name: 'deleted_source', sourceVersionId }))).status,
  ).toBe(404)
  expect(
    (await app.request(`/api/versions/${cloned.database.latestVersion.id}`, as('u1'))).status,
  ).toBe(200)
})

test('finalize and new version routes enforce state, permissions and compacted cache reads', async () => {
  const { body } = await createProduct('u1', 'version-final')
  const productId = body.product.id
  addMember(productId, 'u2', 'member')
  const created = await (
    await app.request(`/api/products/${productId}/databases`, as('u1', 'POST', { name: 'main' }))
  ).json()
  const id = created.database.latestVersion.id
  const path = `/api/versions/${id}`
  const initial = await (await app.request(path, as('u1'))).json()
  const editing = {
    expectedUpdatedAt: initial.data.version.updatedAt,
    expectedRevision: initial.revision,
  }
  expect((await app.request(`${path}/finalize`, as('u1', 'POST', editing))).status).toBe(409)
  const provisional = await (
    await app.request(`${path}/provisional`, as('u2', 'POST', editing))
  ).json()
  const input = {
    expectedUpdatedAt: provisional.version.updatedAt,
    expectedRevision: provisional.revisions.version,
  }
  expect((await app.request(`${path}/finalize`, as('u2', 'POST', input))).status).toBe(403)
  expect(
    (await app.request(`${path}/finalize`, as('u1', 'POST', { ...input, unexpected: true })))
      .status,
  ).toBe(400)
  const finalResponse = await app.request(
    `${path}/finalize`,
    as('u1', 'POST', { ...input, memo: 'release' }),
  )
  expect(finalResponse.status).toBe(200)
  const final = await finalResponse.json()
  expect(final.version.status).toBe('final')
  expect(final.createdVersion).toBeNull()
  const compacted = await (
    await app.request(`${path}?revision=${initial.revision}`, as('u2'))
  ).json()
  expect(compacted.mode).toBe('full')
  const clonePath = `/api/products/${productId}/databases/${created.database.id}/versions`
  const clone = {
    sourceVersionId: id,
    expectedUpdatedAt: final.version.updatedAt,
    expectedRevision: final.version.revision,
  }
  expect((await app.request(clonePath, as('u2', 'POST', clone))).status).toBe(403)
  const nextResponse = await app.request(clonePath, as('u1', 'POST', clone))
  expect(nextResponse.status).toBe(200)
  const next = await nextResponse.json()
  expect(next.version).toMatchObject({ status: 'editing', number: 2, sourceVersionId: id })
  expect((await app.request(clonePath, as('u1', 'POST', clone))).status).toBe(409)
  const p2 = await (
    await app.request(
      `/api/versions/${next.version.id}/provisional`,
      as('u1', 'POST', { expectedUpdatedAt: next.version.updatedAt, expectedRevision: 1 }),
    )
  ).json()
  const f2 = await (
    await app.request(
      `/api/versions/${next.version.id}/finalize`,
      as('u1', 'POST', {
        expectedUpdatedAt: p2.version.updatedAt,
        expectedRevision: p2.version.revision,
        createNext: true,
      }),
    )
  ).json()
  expect(f2.createdVersion).toMatchObject({
    status: 'editing',
    number: 3,
    sourceVersionId: next.version.id,
  })
})

test('provisional checks block errors, allow warnings and enforce revert permissions', async () => {
  const { body: product } = await createProduct('u1', 'version-state')
  const productId = product.product.id
  memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, 'u2'), {
    productId,
    userId: 'u2',
    role: 'member',
    joinedAt: 0,
  })
  const { database } = await (
    await app.request(`/api/products/${productId}/databases`, as('u1', 'POST', { name: 'main' }))
  ).json()
  const path = `/api/versions/${database.latestVersion.id}`
  const scope = await (await app.request(path, as('u1'))).json()
  const key = crypto.randomUUID()
  const input = {
    kind: 'table',
    name: 'items',
    logicalName: null,
    schemaKey: scope.data.objects[0].objectKey,
    definition: {
      columns: [
        {
          key,
          name: 'id',
          logicalName: null,
          dataType: 'bigint',
          notNull: true,
          defaultValue: null,
          comment: null,
          generation: null,
          collation: null,
        },
      ],
      constraints: [] as TableDefinition['constraints'],
      indexes: [],
      size: null,
      options: {},
    },
  }
  const created = await (await app.request(`${path}/objects`, as('u1', 'POST', input))).json()
  const check = await (await app.request(`${path}/validate`, as('u2', 'POST', {}))).json()
  expect(check.errors).toBeGreaterThan(0)
  expect(
    (
      await (
        await app.request(
          `${path}/provisional`,
          as('u2', 'POST', {
            expectedRevision: check.revision,
            expectedUpdatedAt: check.updatedAt,
          }),
        )
      ).json()
    ).transitioned,
  ).toBe(false)
  input.definition.constraints = [
    { kind: 'primary_key', key: crypto.randomUUID(), name: 'items_pk', columns: [key] },
  ]
  await app.request(
    `${path}/objects/${created.object.objectKey}`,
    as('u1', 'PUT', { input, expectedUpdatedAt: created.object.updatedAt }),
  )
  expect(
    (
      await app.request(
        `${path}/provisional`,
        as('u2', 'POST', { expectedRevision: check.revision, expectedUpdatedAt: check.updatedAt }),
      )
    ).status,
  ).toBe(409)
  const next = await (await app.request(`${path}/validate`, as('u2', 'POST', {}))).json()
  expect(next.errors).toBe(0)
  expect(next.warnings).toBeGreaterThan(0)
  const provisional = await (
    await app.request(
      `${path}/provisional`,
      as('u2', 'POST', {
        expectedRevision: next.revision,
        expectedUpdatedAt: next.updatedAt,
        memo: 'test',
      }),
    )
  ).json()
  expect(provisional.transitioned).toBe(true)
  expect(
    (await app.request(`${path}/objects`, as('u1', 'POST', { ...input, name: 'another' }))).status,
  ).toBe(409)
  const revert = {
    expectedRevision: provisional.revisions.version,
    expectedUpdatedAt: provisional.version.updatedAt,
  }
  expect((await app.request(`${path}/revert`, as('u2', 'POST', revert))).status).toBe(403)
  memoryTable(db, 'deployments').set('history', {
    id: 'history',
    toVersionId: database.latestVersion.id,
    connectionName: 'test',
    status: 'succeeded',
  })
  const warning = await (await app.request(`${path}/revert`, as('u1', 'POST', revert))).json()
  expect(warning.requiresConfirmation).toBe(true)
  expect(
    (
      await (
        await app.request(
          `${path}/revert`,
          as('u1', 'POST', { ...revert, acknowledgeApplied: true }),
        )
      ).json()
    ).transitioned,
  ).toBe(true)
})
