import { expect, test } from 'vite-plus/test'

import type { ConnectionDao, ConnectionRecord } from '../dao/connection.interface.ts'
import { createConnectionRepository } from './connection.repository.ts'

const record = (passwordEncrypted: string | null): ConnectionRecord => ({
  id: 'c1',
  productId: 'p1',
  name: '本番',
  connectionString: 'postgresql://app@db.example.com/ec',
  passwordEncrypted,
  sortOrder: 1,
  createdAt: 1,
  updatedAt: 2,
})

const fakeDao = (passwordEncrypted: string | null): ConnectionDao => ({
  findById: async () => record(passwordEncrypted),
  listByProduct: async () => [record(passwordEncrypted)],
  create: async () => ({ connection: record(passwordEncrypted), productRevision: 2 }),
  update: async () => ({ connection: record(passwordEncrypted), productRevision: 3 }),
  delete: async () => ({ productRevision: 4 }),
  reorder: async () => ({ productRevision: 5 }),
})

test('reports whether a password is set, never the ciphertext', async () => {
  const withPassword = await createConnectionRepository(fakeDao('v1.cipher')).findById('p1', 'c1')
  const without = await createConnectionRepository(fakeDao(null)).findById('p1', 'c1')

  expect(withPassword).toEqual({
    id: 'c1',
    productId: 'p1',
    name: '本番',
    connectionString: 'postgresql://app@db.example.com/ec',
    hasPassword: true,
    sortOrder: 1,
    createdAt: 1,
    updatedAt: 2,
  })
  expect(JSON.stringify(withPassword)).not.toContain('cipher')
  expect(without?.hasPassword).toBe(false)
})

test('maps written connections the same way', async () => {
  const repository = createConnectionRepository(fakeDao('v1.cipher'))
  const input = {} as Parameters<ConnectionDao['create']>[0]

  expect(await repository.create(input)).toMatchObject({
    connection: { hasPassword: true },
    productRevision: 2,
  })
  expect(
    JSON.stringify(await repository.update({} as Parameters<ConnectionDao['update']>[0])),
  ).not.toContain('cipher')
})
