import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { DatabaseDao, DatabaseRecord } from '../dao/database.interface.ts'
import { createDatabaseRepository, toDatabaseSummary } from './database.repository.ts'

const record: DatabaseRecord = {
  id: 'd1',
  productId: 'p1',
  name: 'ec_main',
  description: null,
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
  deletedAt: null,
}
const database = {
  id: 'd1',
  productId: 'p1',
  name: 'ec_main',
  description: null,
  createdAt: 1,
  updatedAt: 2,
  revision: 3,
}
const audit: AuditLogRecord = {
  id: 'a',
  productId: 'p1',
  userId: 'u1',
  targetType: 'database',
  action: 'create',
  summary: 'ec_main',
  createdAt: 1,
}

const created: Parameters<DatabaseDao['create']>[0][] = []
const fakeDao: DatabaseDao = {
  findById: async () => record,
  findScope: async (_, databaseId) => ({
    database: record,
    commonColumns: databaseId === 'd2' ? '[{"name":"created_at"}]' : null,
    versions: [],
  }),
  create: async (input) => {
    created.push(input)
    return { productRevision: 4 }
  },
  update: async () => ({ database: { ...record, name: 'renamed' }, productRevision: 5 }),
  delete: async () => ({ productRevision: 6 }),
}

test('maps a database without the storage-only deletedAt', async () => {
  const repository = createDatabaseRepository(fakeDao)

  expect(await repository.findById('p1', 'd1')).toEqual(database)
  expect(
    await repository.update({
      productId: 'p1',
      databaseId: 'd1',
      name: 'renamed',
      description: null,
      expectedUpdatedAt: 2,
      now: 3,
      userId: 'u1',
      allowedRoles: ['owner'],
      audit,
    }),
  ).toEqual({ database: { ...database, name: 'renamed' }, productRevision: 5 })
  expect(
    toDatabaseSummary({
      database: record,
      latestVersion: { id: 'v1', number: 1, status: 'editing', schemaCount: 1, tableCount: 0 },
      latestFinalVersion: null,
    }).database,
  ).toEqual(database)
})

test('stores a new database as not deleted', async () => {
  const repository = createDatabaseRepository(fakeDao)

  await repository.create({
    database,
    versionId: 'v1',
    schema: null,
    maxDatabases: 20,
    userId: 'u1',
    allowedRoles: ['owner'],
    audit,
  })

  expect(created[0]?.database).toEqual(record)
})

test('maps the database scope, parsing the common column set', async () => {
  const repository = createDatabaseRepository(fakeDao)

  expect(await repository.findScope('p1', 'd1')).toEqual({
    database,
    commonColumns: [],
    versions: [],
  })
  expect((await repository.findScope('p1', 'd2'))?.commonColumns).toEqual([{ name: 'created_at' }])
})
