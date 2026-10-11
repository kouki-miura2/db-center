import type { AuditLogDao } from 'backend/src/dao/audit-log.dao.interface.ts'
import type { AuditLogRecord } from 'backend/src/dao/audit-log.interface.ts'

interface EntryRow {
  id: string
  product_id: string
  user_id: string
  target_type: AuditLogRecord['targetType']
  action: string
  summary: string
  created_at: number
  user_name: string
}

/** D1 `AuditLogDao`. Pages walk `audit_logs(product_id, created_at, id)`. */
export const createAuditLogD1Dao = (db: D1Database): AuditLogDao => ({
  list: async ({ productId, before, after, limit }) => {
    const conditions = ['audit_logs.product_id = ?']
    const params: unknown[] = [productId]
    if (before) {
      conditions.push(
        '(audit_logs.created_at < ? OR (audit_logs.created_at = ? AND audit_logs.id < ?))',
      )
      params.push(before.createdAt, before.createdAt, before.id)
    }
    if (after) {
      conditions.push(
        '(audit_logs.created_at > ? OR (audit_logs.created_at = ? AND audit_logs.id > ?))',
      )
      params.push(after.createdAt, after.createdAt, after.id)
    }
    const { results } = await db
      .prepare(
        `SELECT audit_logs.*, users.name AS user_name FROM audit_logs JOIN users ON users.id = audit_logs.user_id WHERE ${conditions.join(' AND ')} ORDER BY audit_logs.created_at DESC, audit_logs.id DESC LIMIT ?`,
      )
      .bind(...params, limit)
      .all<EntryRow>()
    return results.map((row) => ({
      id: row.id,
      productId: row.product_id,
      userId: row.user_id,
      targetType: row.target_type,
      action: row.action,
      summary: row.summary,
      createdAt: row.created_at,
      userName: row.user_name,
    }))
  },
})
