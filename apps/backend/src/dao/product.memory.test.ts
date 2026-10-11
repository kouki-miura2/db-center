import { createMemoryDb, memoryTable } from './memory-db.ts'
import { productDaoContract } from './product.contract.ts'
import type { ProductRecord } from './product.interface.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

productDaoContract(async () => {
  const db = createMemoryDb()
  const users = memoryTable<UserRecord>(db, 'users')
  const addUser = async (id: string) => {
    users.set(id, {
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
  await Promise.all(['u1', 'u2', 'u3'].map(addUser))
  return {
    dao: createProductMemoryDao(db),
    addUser,
    addMember: async (productId, userId, role) => {
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
        productId,
        userId,
        role,
        joinedAt: 1000,
      })
    },
    markDeleted: async (productId) => {
      const product = memoryTable<ProductRecord>(db, 'products').get(productId)
      if (product) product.deletedAt = 5000
    },
    countAuditLogs: async () => memoryTable(db, 'audit_logs').size,
    productsRevision: async (userId) =>
      memoryTable<UserRecord>(db, 'users').get(userId)?.productsRevision ?? 0,
  }
})
