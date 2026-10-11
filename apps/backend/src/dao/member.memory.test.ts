import { memberDaoContract } from './member.contract.ts'
import { createMemberMemoryDao } from './member.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { createProductMemoryDao, memberKey, type MemberRow } from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

memberDaoContract(async () => {
  const db = createMemoryDb()
  for (const id of ['u1', 'u2', 'u3']) {
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
    dao: createMemberMemoryDao(db),
    products: createProductMemoryDao(db),
    addMember: async (productId, userId, role) => {
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
        productId,
        userId,
        role,
        joinedAt: 0,
      })
    },
    productsRevision: async (userId) =>
      memoryTable<UserRecord>(db, 'users').get(userId)?.productsRevision ?? 0,
    countAuditLogs: async () => memoryTable(db, 'audit_logs').size,
  }
})
