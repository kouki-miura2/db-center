import { LIMITS } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import { AppError } from '../error.ts'
import type { Database, DatabaseRepository, Version } from '../repository/database.repository.ts'
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
  findVersion: async () => null,
  findById: async () => database,
  findScope: async () => null,
  saveCommonColumns: async () => ({ revision: 4 }),
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

const version = (number: number, status: Version['status']): Version => ({
  id: `v${number}`,
  databaseId: 'd1',
  number,
  status,
  sourceVersionId: number === 1 ? null : `v${number - 1}`,
  memo: null,
  provisionalAt: null,
  finalizedAt: null,
  createdAt: number,
  updatedAt: number,
  revision: 1,
  compactedRevision: 1,
  schemaCount: 1,
  tableCount: number,
  definitionBytes: 2,
})

test('answers the database scope unchanged after reading only the database row', async () => {
  const findScope = vi.fn()

  const result = await service('member', fakeDatabases({ findScope })).getDatabase({
    userId: 'u1',
    productId: 'p1',
    databaseId: 'd1',
    clientRevision: 3,
  })

  expect(result).toEqual({ mode: 'unchanged', revision: 3 })
  expect(findScope).not.toHaveBeenCalled()
})

test('returns the whole database scope, versions newest first', async () => {
  const databases = fakeDatabases({
    findScope: async () => ({
      database: { ...database, revision: 4 },
      commonColumns: [{ name: 'created_at' }],
      versions: [version(1, 'final'), version(3, 'editing'), version(2, 'final')],
    }),
  })

  const result = await service('member', databases).getDatabase({
    userId: 'u1',
    productId: 'p1',
    databaseId: 'd1',
    clientRevision: 2,
  })

  expect(result).toMatchObject({
    mode: 'full',
    revision: 4,
    data: {
      database: { id: 'd1', name: 'ec_main', description: '基幹', createdAt: 1, updatedAt: 2 },
      commonColumns: [{ name: 'created_at' }],
    },
  })
  if (result.mode !== 'full') throw new Error('expected full')
  expect(result.data.versions.map((v) => v.number)).toEqual([3, 2, 1])
  expect(result.data.versions[0]).toEqual({
    id: 'v3',
    number: 3,
    status: 'editing',
    sourceVersionId: 'v2',
    memo: null,
    provisionalAt: null,
    finalizedAt: null,
    createdAt: 3,
    updatedAt: 3,
    schemaCount: 1,
    tableCount: 3,
  })
})

test('hides the database scope from a non-member, and a deleted database', async () => {
  const input = { userId: 'u1', productId: 'p1', databaseId: 'd1' }

  await expect(service(null).getDatabase(input)).rejects.toMatchObject({ code: 'not_found' })
  await expect(
    service('owner', fakeDatabases({ findById: async () => null })).getDatabase(input),
  ).rejects.toMatchObject({ code: 'not_found' })
})

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

test('any member saves the common column set at the revision they edited', async () => {
  const save = vi.fn<DatabaseRepository['saveCommonColumns']>(async () => ({ revision: 5 }))

  const result = await service(
    'member',
    fakeDatabases({ saveCommonColumns: save }),
  ).saveCommonColumns({
    userId: 'u1',
    productId: 'p1',
    databaseId: 'd1',
    columns: [createdAt],
    expectedRevision: 4,
  })

  expect(save.mock.calls[0]?.[0]).toEqual({
    productId: 'p1',
    databaseId: 'd1',
    commonColumns: [createdAt],
    expectedRevision: 4,
    userId: 'u1',
    allowedRoles: ['owner', 'manager', 'member'],
  })
  expect(result).toEqual({ commonColumns: [createdAt], revisions: { database: 5 } })
})

test('checks the common columns against the product’s target before saving', async () => {
  const save = vi.fn()
  const sqlite = service('owner', fakeDatabases({ saveCommonColumns: save }), 'sqlite3')
  const input = { userId: 'u1', productId: 'p1', databaseId: 'd1', expectedRevision: 4 }

  await expect(
    sqlite.saveCommonColumns({ ...input, columns: [{ ...createdAt, storage: 'main' }] }),
  ).rejects.toMatchObject({
    code: 'invalid_input',
    fields: { 'columns.0.storage': expect.any(String) },
  })
  await expect(
    service('owner', fakeDatabases({ findById: async () => null })).saveCommonColumns({
      ...input,
      columns: [],
    }),
  ).rejects.toMatchObject({ code: 'not_found' })
  expect(save).not.toHaveBeenCalled()
})
