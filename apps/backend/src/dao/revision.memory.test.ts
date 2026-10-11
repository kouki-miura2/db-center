import { createDatabaseMemoryDao } from './database.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { createProductMemoryDao } from './product.memory.ts'
import { revisionDaoContract } from './revision.contract.ts'
import { createRevisionMemoryDao } from './revision.memory.ts'
import type { UserRecord } from './user.interface.ts'

revisionDaoContract(async () => {
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
    dao: createRevisionMemoryDao(db),
    products: createProductMemoryDao(db),
    databases: createDatabaseMemoryDao(db),
    markProductDeleted: async (productId) => {
      const product = memoryTable<ProductRecord>(db, 'products').get(productId)
      if (product) product.deletedAt = 5000
    },
  }
})
