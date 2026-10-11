import { LIMITS } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import { AppError } from '../error.ts'
import type { Connection, ConnectionRepository } from '../repository/connection.repository.ts'
import type { Membership, ProductRepository } from '../repository/product.repository.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { createConnectionService } from './connection.service.ts'

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

const connection: Connection = {
  id: 'c1',
  productId: 'p1',
  name: '本番',
  connectionString: 'postgresql://app@db.example.com/ec',
  hasPassword: true,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 2,
}

const fakeConnections = (overrides: Partial<ConnectionRepository> = {}): ConnectionRepository => ({
  findCredentials: async () => null,
  findById: async () => connection,
  create: async () => ({ connection, productRevision: 4 }),
  update: async () => ({ connection, productRevision: 4 }),
  delete: async () => ({ productRevision: 4 }),
  reorder: async () => ({ productRevision: 4 }),
  ...overrides,
})

const secrets: SecretBox = {
  encrypt: async (plaintext, purpose, recordId) => `enc(${plaintext}|${purpose}|${recordId})`,
  decrypt: async () => {
    throw new Error('unused')
  },
}

const input = {
  userId: 'u1',
  productId: 'p1',
  name: '本番',
  connectionString: ' postgresql://app@db.example.com/ec ',
}

test('encrypts the password with the new connection’s ID and returns no password', async () => {
  const create = vi.fn<ConnectionRepository['create']>(async () => ({
    connection,
    productRevision: 4,
  }))
  const service = createConnectionService({
    products: products(membership('manager')),
    connections: fakeConnections({ create }),
    secrets,
  })

  const result = await service.createConnection({ ...input, password: 'secret' })

  const stored = create.mock.calls[0]?.[0]
  expect(stored?.connection).toMatchObject({
    connectionString: 'postgresql://app@db.example.com/ec',
    passwordEncrypted: `enc(secret|connection-password|${stored?.connection.id})`,
  })
  expect(stored).toMatchObject({
    maxConnections: LIMITS.connectionsPerProduct,
    allowedRoles: ['owner', 'manager'],
    audit: { targetType: 'connection', action: 'create', summary: '本番' },
  })
  expect(result).toEqual({
    connection: {
      id: 'c1',
      name: '本番',
      connectionString: 'postgresql://app@db.example.com/ec',
      hasPassword: true,
      sortOrder: 1,
      updatedAt: 2,
    },
    revisions: { product: 4 },
  })
  expect(JSON.stringify(stored?.audit)).not.toContain('secret')
})

test.each([
  ['a member', membership('member'), 'forbidden'],
  ['a non-member', null, 'not_found'],
  ['a SQLite 3 product', membership('owner', 'sqlite3'), 'invalid_state'],
] as const)('refuses connections for %s', async (_, found, code) => {
  const create = vi.fn()
  const service = createConnectionService({
    products: products(found),
    connections: fakeConnections({ create }),
    secrets,
  })

  await expect(service.createConnection(input)).rejects.toMatchObject({ code })
  expect(create).not.toHaveBeenCalled()
})

test('refuses a connection string with a password in it', async () => {
  const service = createConnectionService({
    products: products(membership('owner')),
    connections: fakeConnections(),
    secrets,
  })

  await expect(
    service.createConnection({
      ...input,
      connectionString: 'postgresql://app:pw@db.example.com/ec',
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' })
})

test('explains the connection limit', async () => {
  const service = createConnectionService({
    products: products(membership('owner')),
    connections: fakeConnections({
      create: async () => {
        throw new AppError('limit_exceeded')
      },
    }),
    secrets,
  })

  await expect(service.createConnection(input)).rejects.toMatchObject({
    message: `接続情報は${LIMITS.connectionsPerProduct}件までです`,
  })
})

test.each([
  ['keeps the password when omitted', undefined, undefined],
  ['removes it when null', null, null],
  ['replaces it when given', 'new', 'enc(new|connection-password|c1)'],
] as const)('an update %s', async (_, password, stored) => {
  const update = vi.fn<ConnectionRepository['update']>(async () => ({
    connection,
    productRevision: 4,
  }))
  const service = createConnectionService({
    products: products(membership('owner')),
    connections: fakeConnections({ update }),
    secrets,
  })

  await service.updateConnection({
    ...input,
    connectionId: 'c1',
    expectedUpdatedAt: 2,
    ...(password === undefined ? {} : { password }),
  })

  expect(update.mock.calls[0]?.[0].passwordEncrypted).toBe(stored)
})

test('deletes an existing connection, logging its name; an unknown one is 404', async () => {
  const remove = vi.fn<ConnectionRepository['delete']>(async () => ({ productRevision: 5 }))
  const service = createConnectionService({
    products: products(membership('owner')),
    connections: fakeConnections({ delete: remove }),
    secrets,
  })
  const missing = createConnectionService({
    products: products(membership('owner')),
    connections: fakeConnections({ findById: async () => null }),
    secrets,
  })
  const target = { userId: 'u1', productId: 'p1', connectionId: 'c1', expectedUpdatedAt: 2 }

  expect(await service.deleteConnection(target)).toEqual({ revisions: { product: 5 } })
  expect(remove.mock.calls[0]?.[0].audit).toMatchObject({ action: 'delete', summary: '本番' })
  await expect(missing.deleteConnection(target)).rejects.toMatchObject({ code: 'not_found' })
})
