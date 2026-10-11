import { createDatabaseMemoryDao } from './database.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { objectDaoContract } from './object.contract.ts'
import { createObjectMemoryDao } from './object.memory.ts'
import { createProductMemoryDao, memberKey } from './product.memory.ts'

objectDaoContract(async () => {
  const db = createMemoryDb()
  memoryTable(db, 'users').set('u1', { id: 'u1', productsRevision: 1 })
  const audit = {
    id: 'a1',
    productId: 'p1',
    userId: 'u1',
    targetType: 'database' as const,
    action: 'create',
    summary: '',
    createdAt: 1000,
  }
  await createProductMemoryDao(db).create({
    product: {
      id: 'p1',
      name: 'p',
      target: 'postgresql18',
      createdAt: 1000,
      updatedAt: 1000,
      revision: 1,
      deletedAt: null,
    },
    ownerId: 'u1',
    maxProducts: 20,
    audit,
  })
  await createDatabaseMemoryDao(db).create({
    database: {
      id: 'd1',
      productId: 'p1',
      name: 'db',
      description: null,
      createdAt: 1000,
      updatedAt: 1000,
      revision: 1,
      deletedAt: null,
    },
    versionId: 'v1',
    schema: { id: 's1', objectKey: 'schema', name: 'public', definition: '{}' },
    maxDatabases: 20,
    userId: 'u1',
    allowedRoles: ['owner'],
    audit: { ...audit, id: 'a2' },
  })
  return {
    dao: createObjectMemoryDao(db),
    audits: async () => memoryTable(db, 'audit_logs').size,
    removeActor: async () => {
      memoryTable(db, 'product_members').delete(memberKey('p1', 'u1'))
    },
  }
})
