import { auditLogDaoContract } from './audit-log.contract.ts'
import type { AuditLogRecord } from './audit-log.interface.ts'
import { createAuditLogMemoryDao } from './audit-log.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import type { UserRecord } from './user.interface.ts'

auditLogDaoContract(async () => {
  const db = createMemoryDb()
  const users = memoryTable<UserRecord>(db, 'users')
  users.set('u1', {
    id: 'u1',
    googleSub: 'sub-1',
    email: 'u1@example.com',
    name: 'はなこ',
    termsVersion: 'v',
    agreedAt: 0,
    lastLoginAt: 0,
    productsRevision: 1,
    createdAt: 0,
    deletedAt: null,
  })
  return {
    dao: createAuditLogMemoryDao(db),
    addEntry: async (id, productId, createdAt) => {
      memoryTable<AuditLogRecord>(db, 'audit_logs').set(id, {
        id,
        productId,
        userId: 'u1',
        targetType: 'product',
        action: 'update',
        summary: id,
        createdAt,
      })
    },
    renameUser: async (name) => {
      const user = users.get('u1')
      if (user) user.name = name
    },
  }
})
