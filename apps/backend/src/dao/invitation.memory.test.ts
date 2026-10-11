import { invitationDaoContract } from './invitation.contract.ts'
import { createInvitationMemoryDao } from './invitation.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

invitationDaoContract(async () => {
  const db = createMemoryDb()
  for (const id of ['u1', 'u2', 'u3', 'u4']) {
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
    dao: createInvitationMemoryDao(db),
    products: createProductMemoryDao(db),
    addMember: async (productId, userId, role) => {
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
        productId,
        userId,
        role,
        joinedAt: 0,
      })
    },
    markDeleted: async (productId) => {
      const product = memoryTable<ProductRecord>(db, 'products').get(productId)
      if (product) product.deletedAt = 5000
    },
    countAuditLogs: async () => memoryTable(db, 'audit_logs').size,
  }
})
