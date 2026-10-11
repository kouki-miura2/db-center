import type { AuditLogRecord } from './audit-log.interface.ts'
import type { ConnectionRecord } from './connection.interface.ts'
import type { DatabaseRecord, VersionRecord } from './database.interface.ts'
import type { ObjectRow } from './database.memory.ts'
import type { DeploymentRecord } from './deployment.interface.ts'
import type { InvitationRecord } from './invitation.interface.ts'
import type { MaintenanceDao, PurgeKind } from './maintenance.interface.ts'
import { atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { bumpProductRevision, type MemberRow } from './product.memory.ts'
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

// Deletes every row of a table that matches, returning the deleted rows.
const deleteAll = <T>(db: MemoryDb, table: string, matches: (row: T) => boolean) => {
  const rows = memoryTable<T>(db, table)
  const deleted = [...rows.entries()].filter(([, row]) => matches(row))
  deleted.forEach(([key]) => rows.delete(key))
  return deleted.map(([, row]) => row)
}

// A database and what's under it, as the D1 foreign keys cascade: its versions (and their
// objects and deployments); other versions created from them lose their source.
const deleteDatabase = (db: MemoryDb, databaseId: string) => {
  memoryTable<DatabaseRecord>(db, 'databases').delete(databaseId)
  const versionIds = new Set(
    deleteAll<VersionRecord>(db, 'versions', (row) => row.databaseId === databaseId).map(
      (row) => row.id,
    ),
  )
  deleteAll<ObjectRow>(db, 'objects', (row) => versionIds.has(row.versionId))
  deleteAll<DeploymentRecord>(db, 'deployments', (row) => row.databaseId === databaseId)
  memoryTable<VersionRecord>(db, 'versions').forEach((row) => {
    if (row.sourceVersionId !== null && versionIds.has(row.sourceVersionId)) {
      row.sourceVersionId = null
    }
  })
}

const deleteProduct = (db: MemoryDb, productId: string) => {
  memoryTable<ProductRecord>(db, 'products').delete(productId)
  const ofProduct = (row: { productId: string }) => row.productId === productId
  const databases = [...memoryTable<DatabaseRecord>(db, 'databases').values()].filter(ofProduct)
  databases.forEach((row) => deleteDatabase(db, row.id))
  deleteAll<MemberRow>(db, 'product_members', ofProduct)
  deleteAll<InvitationRecord>(db, 'invitations', ofProduct)
  deleteAll<ConnectionRecord>(db, 'connections', ofProduct)
  deleteAll<DeploymentRecord>(db, 'deployments', ofProduct)
  deleteAll<AuditLogRecord>(db, 'audit_logs', ofProduct)
}

// The deleted product or database rows of a kind.
const deletedRows = (db: MemoryDb, kind: PurgeKind) => [
  ...memoryTable<{ id: string; deletedAt: number | null }>(
    db,
    kind === 'product' ? 'products' : 'databases',
  ).values(),
]

const deploymentsUnder = (db: MemoryDb, kind: PurgeKind, id: string) =>
  [...memoryTable<DeploymentRecord>(db, 'deployments').values()].filter((row) =>
    kind === 'product' ? row.productId === id : row.databaseId === id,
  )

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

  findPurgeable: async ({ kind, cutoff, after, limit }) =>
    deletedRows(db, kind)
      .filter(
        (row) =>
          row.deletedAt !== null && row.deletedAt <= cutoff && (after === null || row.id > after),
      )
      .toSorted((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((row) => {
        const deployments = deploymentsUnder(db, kind, row.id)
        return {
          id: row.id,
          deploymentIds: deployments.map((deployment) => deployment.id),
          running: deployments.some((deployment) => deployment.status === 'running'),
        }
      }),

  purge: async ({ kind, id, cutoff }) =>
    atomic(db, () => {
      const row = deletedRows(db, kind).find((candidate) => candidate.id === id)
      if (!row || row.deletedAt === null || row.deletedAt > cutoff) return false
      if (deploymentsUnder(db, kind, id).some((deployment) => deployment.status === 'running')) {
        return false
      }
      if (kind === 'product') deleteProduct(db, id)
      else deleteDatabase(db, id)
      return true
    }),
})
