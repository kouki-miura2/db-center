import type { AuditLogRecord } from './audit-log.interface.ts'
import type { VersionRecord } from './database.interface.ts'
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
    // Only the fields the cleanup reads; the rest of each row doesn't matter here.
    addDatabase: async (id, productId) => {
      memoryTable(db, 'databases').set(id, { id, productId, deletedAt: null })
      memoryTable(db, 'versions').set(`v-${id}`, {
        id: `v-${id}`,
        databaseId: id,
        sourceVersionId: null,
      })
      memoryTable(db, 'objects').set(`o-${id}`, { id: `o-${id}`, versionId: `v-${id}` })
    },
    addVersion: async (id, databaseId, sourceVersionId) => {
      memoryTable(db, 'versions').set(id, { id, databaseId, sourceVersionId })
    },
    addConnection: async (id, productId) => {
      memoryTable(db, 'connections').set(id, { id, productId })
    },
    addMember: async (productId) => {
      memoryTable(db, 'product_members').set(`${productId}:u1`, { productId, userId: 'u1' })
    },
    addDeployment: async ({ id, productId, databaseId, connectionId, status }) => {
      memoryTable(db, 'deployments').set(id, { id, productId, databaseId, connectionId, status })
    },
    markDeleted: async (kind, id, deletedAt) => {
      const row = memoryTable<{ deletedAt: number | null }>(
        db,
        kind === 'product' ? 'products' : 'databases',
      ).get(id)
      if (row) row.deletedAt = deletedAt
    },
    count: async (table) => memoryTable(db, table).size,
    sourceVersionOf: async (versionId) =>
      memoryTable<VersionRecord>(db, 'versions').get(versionId)?.sourceVersionId ?? null,
  }
})
