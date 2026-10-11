import { databaseDaoContract } from './database.contract.ts'
import { createDatabaseMemoryDao, objects, versions } from './database.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { createObjectMemoryDao } from './object.memory.ts'
import type { ProductRecord } from './product.interface.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'
import { createVersionMemoryDao } from './version.memory.ts'

databaseDaoContract(async () => {
  const db = createMemoryDb()
  for (const id of ['u1', 'u2']) {
    memoryTable<UserRecord>(db, 'users').set(id, {
      id,
      googleSub: `sub-${id}`,
      email: `${id}@example.com`,
      name: id,
      termsVersion: 'v',
      agreedAt: 0,
      lastLoginAt: 0,
      productsRevision: 1,
      createdAt: 0,
      deletedAt: null,
    })
  }
  return {
    dao: createDatabaseMemoryDao(db),
    products: createProductMemoryDao(db),
    objects: createObjectMemoryDao(db),
    versions: createVersionMemoryDao(db),
    addMember: async (productId, userId, role) => {
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
        productId,
        userId,
        role,
        joinedAt: 0,
      })
    },
    markProductDeleted: async (productId) => {
      const product = memoryTable<ProductRecord>(db, 'products').get(productId)
      if (product) product.deletedAt = 5000
    },
    countAuditLogs: async () => memoryTable(db, 'audit_logs').size,
    objectNames: async (versionId) =>
      [...objects(db).values()].filter((row) => row.versionId === versionId).map((row) => row.name),
    definitionBytes: async (versionId) => versions(db).get(versionId)?.definitionBytes ?? 0,
  }
})
