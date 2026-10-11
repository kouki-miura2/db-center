import type { AuditLogRecord } from './audit-log.interface.ts'

/** A position in a product's audit log, newest first: entries are ordered by (createdAt, id). */
export interface AuditLogCursor {
  createdAt: number
  id: string
}

/** An audit log entry with its actor's current name (退会したユーザー once they withdraw). */
export type AuditLogEntryRecord = AuditLogRecord & { userName: string }

export interface AuditLogDao {
  /**
   * A product's entries, newest first, at most `limit`: those older than `before`, those newer than
   * `after`, or the newest when neither is given.
   */
  list: (input: {
    productId: string
    before?: AuditLogCursor
    after?: AuditLogCursor
    limit: number
  }) => Promise<AuditLogEntryRecord[]>
}
