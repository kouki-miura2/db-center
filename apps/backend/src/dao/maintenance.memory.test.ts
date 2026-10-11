import type { AuditLogRecord } from './audit-log.interface.ts'
import type { InvitationRecord } from './invitation.interface.ts'
import { maintenanceDaoContract } from './maintenance.contract.ts'
import { createMaintenanceMemoryDao } from './maintenance.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import type { SessionRecord } from './user.interface.ts'

maintenanceDaoContract(async () => {
  const db = createMemoryDb()
  for (const id of ['p1', 'p2']) {
    memoryTable<ProductRecord>(db, 'products').set(id, {
      id,
      name: id,
      target: 'postgresql18',
      createdAt: 0,
      updatedAt: 0,
      revision: 1,
      deletedAt: null,
    })
  }
  return {
    dao: createMaintenanceMemoryDao(db),
    addSession: async (id, expiresAt) => {
      memoryTable<SessionRecord>(db, 'sessions').set(id, {
        id,
        userId: 'u1',
        expiresAt,
        createdAt: 0,
      })
    },
    addInvitation: async (id, productId, expiresAt) => {
      memoryTable<InvitationRecord>(db, 'invitations').set(id, {
        id,
        productId,
        email: `${id}@example.com`,
        role: 'member',
        passcodeHash: 'h',
        passcodeEncrypted: 'e',
        invitedBy: 'u1',
        expiresAt,
        createdAt: 0,
      })
    },
    addPasscodeFailure: async (id, failedAt) => {
      memoryTable(db, 'passcode_failures').set(id, { id, userId: 'u1', failedAt })
    },
    addAuditLog: async (entry) => {
      memoryTable<AuditLogRecord>(db, 'audit_logs').set(entry.id, entry)
    },
    sessionIds: async () => [...memoryTable(db, 'sessions').keys()],
    invitationIds: async () => [...memoryTable(db, 'invitations').keys()],
    passcodeFailureIds: async () => [...memoryTable(db, 'passcode_failures').keys()],
    auditLogs: async () =>
      Object.fromEntries(
        [...memoryTable<AuditLogRecord>(db, 'audit_logs').values()].map((row) => [
          row.id,
          row.summary,
        ]),
      ),
    productRevision: async (productId) =>
      memoryTable<ProductRecord>(db, 'products').get(productId)?.revision ?? 0,
  }
})
