import type { AuditLogRecord } from './audit-log.interface.ts'
import type { InvitationRecord } from './invitation.interface.ts'
import type { MaintenanceDao } from './maintenance.interface.ts'
import { atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import { bumpProductRevision } from './product.memory.ts'
import type { SessionRecord } from './user.interface.ts'

// The keys of at most `limit` rows of a table that match.
const pick = <T>(db: MemoryDb, table: string, matches: (row: T) => boolean, limit: number) =>
  [...memoryTable<T>(db, table).entries()]
    .filter(([, row]) => matches(row))
    .slice(0, limit)
    .map(([key]) => key)

const deleteWhere = <T>(
  db: MemoryDb,
  table: string,
  matches: (row: T) => boolean,
  limit: number,
) => {
  const keys = pick(db, table, matches, limit)
  keys.forEach((key) => memoryTable<T>(db, table).delete(key))
  return keys.length
}

/** In-memory `MaintenanceDao` over the shared `MemoryDb`. */
export const createMaintenanceMemoryDao = (db: MemoryDb): MaintenanceDao => ({
  deleteExpiredSessions: async (cutoff, limit) =>
    deleteWhere<SessionRecord>(db, 'sessions', (row) => row.expiresAt <= cutoff, limit),

  deleteExpiredInvitations: async (cutoff, limit) =>
    atomic(db, () => {
      const invitations = memoryTable<InvitationRecord>(db, 'invitations')
      const keys = pick<InvitationRecord>(
        db,
        'invitations',
        (row) => row.expiresAt <= cutoff,
        limit,
      )
      const productIds = new Set(keys.map((key) => invitations.get(key)?.productId ?? ''))
      keys.forEach((key) => invitations.delete(key))
      productIds.forEach((productId) => bumpProductRevision(db, productId))
      return keys.length
    }),

  deletePasscodeFailures: async (cutoff, limit) =>
    deleteWhere<{ failedAt: number }>(
      db,
      'passcode_failures',
      (row) => row.failedAt <= cutoff,
      limit,
    ),

  redactInvitationEmails: async ({ cutoff, replacement, limit }) => {
    const logs = memoryTable<AuditLogRecord>(db, 'audit_logs')
    const keys = pick<AuditLogRecord>(
      db,
      'audit_logs',
      (row) => row.action === 'invite' && row.createdAt <= cutoff && row.summary.includes('@'),
      limit,
    )
    keys.forEach((key) => {
      const row = logs.get(key)
      if (!row) return
      const role = row.summary.indexOf('（')
      row.summary = replacement + (role >= 0 ? row.summary.slice(role) : '')
    })
    return keys.length
  },

  deleteAuditLogs: async (cutoff, limit) =>
    deleteWhere<AuditLogRecord>(db, 'audit_logs', (row) => row.createdAt <= cutoff, limit),
})
