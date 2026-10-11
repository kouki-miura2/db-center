import type { AuditLogRecord } from './audit-log.interface.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { memberKey, type MemberRow } from './product.memory.ts'
import { userDaoContract } from './user.contract.ts'
import { createUserMemoryDao } from './user.memory.ts'

userDaoContract(async () => {
  const db = createMemoryDb()
  return {
    dao: createUserMemoryDao(db),
    countSessions: async () => memoryTable(db, 'sessions').size,
    addProduct: async (productId, ownerId, deleted = false) => {
      memoryTable<ProductRecord>(db, 'products').set(productId, {
        id: productId,
        name: productId,
        target: 'postgresql18',
        createdAt: 0,
        updatedAt: 0,
        revision: 1,
        deletedAt: deleted ? 1 : null,
      })
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, ownerId), {
        productId,
        userId: ownerId,
        role: 'owner',
        joinedAt: 0,
      })
    },
    addMember: async (productId, userId, role) => {
      memoryTable<MemberRow>(db, 'product_members').set(memberKey(productId, userId), {
        productId,
        userId,
        role,
        joinedAt: 0,
      })
    },
    countMemberships: async (userId) =>
      [...memoryTable<MemberRow>(db, 'product_members').values()].filter(
        (row) => row.userId === userId,
      ).length,
    productRevision: async (productId) =>
      memoryTable<ProductRecord>(db, 'products').get(productId)?.revision ?? 0,
    auditLogs: async () =>
      [...memoryTable<AuditLogRecord>(db, 'audit_logs').values()].map((row) => [
        row.productId,
        row.action,
        row.summary,
      ]),
  }
})
