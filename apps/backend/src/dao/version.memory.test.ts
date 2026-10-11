import { databases, objects, versions } from './database.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { createObjectMemoryDao } from './object.memory.ts'
import { memberKey } from './product.memory.ts'
import { versionDaoContract } from './version.contract.ts'
import { createVersionMemoryDao } from './version.memory.ts'
versionDaoContract(async () => {
  const db = createMemoryDb()
  memoryTable(db, 'products').set('p1', {
    id: 'p1',
    target: 'postgresql18',
    revision: 1,
    deletedAt: null,
  })
  memoryTable(db, 'product_members').set(memberKey('p1', 'u1'), {
    productId: 'p1',
    userId: 'u1',
    role: 'owner',
  })
  databases(db).set('d1', {
    id: 'd1',
    productId: 'p1',
    name: 'db',
    description: null,
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    deletedAt: null,
    commonColumns: null,
  })
  versions(db).set('v1', {
    id: 'v1',
    databaseId: 'd1',
    number: 1,
    status: 'editing',
    sourceVersionId: null,
    memo: null,
    provisionalAt: null,
    finalizedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    compactedRevision: 1,
    schemaCount: 0,
    tableCount: 0,
    definitionBytes: 0,
  })
  void objects(db)
  return {
    dao: createVersionMemoryDao(db),
    objects: createObjectMemoryDao(db),
    application: async (status) => {
      memoryTable(db, 'deployments').set('deployment', {
        id: 'deployment',
        toVersionId: 'v1',
        connectionName: 'test',
        status,
      })
    },
    audits: async () => memoryTable(db, 'audit_logs').size,
  }
})
