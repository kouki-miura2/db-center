import type { AuditLogCursor, AuditLogDao } from './audit-log.dao.interface.ts'
import type { AuditLogRecord } from './audit-log.interface.ts'
import { type MemoryDb, memoryTable } from './memory-db.ts'
import type { UserRecord } from './user.interface.ts'

// Positive when `a` comes after `b` in (createdAt, id) order.
const compare = (a: AuditLogCursor, b: AuditLogCursor) =>
  a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/** In-memory `AuditLogDao` over the shared `MemoryDb`. */
export const createAuditLogMemoryDao = (db: MemoryDb): AuditLogDao => ({
  list: async ({ productId, before, after, limit }) =>
    [...memoryTable<AuditLogRecord>(db, 'audit_logs').values()]
      .filter(
        (row) =>
          row.productId === productId &&
          (!before || compare(row, before) < 0) &&
          (!after || compare(row, after) > 0),
      )
      .sort((a, b) => compare(b, a))
      .slice(0, limit)
      .map((row) => ({
        ...row,
        userName: memoryTable<UserRecord>(db, 'users').get(row.userId)?.name ?? '',
      })),
})
