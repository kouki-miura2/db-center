import type { MaintenanceDao } from 'backend/src/dao/maintenance.interface.ts'

// SQLite here has no `DELETE ... LIMIT`: each statement limits a subquery on an indexed column.
const deleteUpTo = async (
  db: D1Database,
  table: string,
  column: string,
  cutoff: number,
  limit: number,
) => {
  const result = await db
    .prepare(
      `DELETE FROM ${table} WHERE id IN (SELECT id FROM ${table} WHERE ${column} <= ? LIMIT ?)`,
    )
    .bind(cutoff, limit)
    .run()
  return result.meta.changes
}

/** D1 `MaintenanceDao`. */
export const createMaintenanceD1Dao = (db: D1Database): MaintenanceDao => ({
  deleteExpiredSessions: (cutoff, limit) => deleteUpTo(db, 'sessions', 'expires_at', cutoff, limit),

  deleteExpiredInvitations: async (cutoff, limit) => {
    const { results } = await db
      .prepare('SELECT id, product_id FROM invitations WHERE expires_at <= ? LIMIT ?')
      .bind(cutoff, limit)
      .all<{ id: string; product_id: string }>()
    if (results.length === 0) return 0
    const ids = JSON.stringify(results.map((row) => row.id))
    const productIds = JSON.stringify([...new Set(results.map((row) => row.product_id))])
    // One batch: the products' revisions move with the invitations they no longer list.
    const [, deleted] = await db.batch([
      db
        .prepare(
          'UPDATE products SET revision = revision + 1 WHERE id IN (SELECT value FROM json_each(?))',
        )
        .bind(productIds),
      db
        .prepare(
          'DELETE FROM invitations WHERE id IN (SELECT value FROM json_each(?)) AND expires_at <= ?',
        )
        .bind(ids, cutoff),
    ])
    return deleted?.meta.changes ?? 0
  },

  deletePasscodeFailures: (cutoff, limit) =>
    deleteUpTo(db, 'passcode_failures', 'failed_at', cutoff, limit),

  // Walks the partial index audit_logs_invite_email, whose condition this query repeats.
  redactInvitationEmails: async ({ cutoff, replacement, limit }) => {
    const result = await db
      .prepare(
        `UPDATE audit_logs
        SET summary = ? || CASE WHEN instr(summary, '（') > 0 THEN substr(summary, instr(summary, '（')) ELSE '' END
        WHERE id IN (
          SELECT id FROM audit_logs
          WHERE action = 'invite' AND instr(summary, '@') > 0 AND created_at <= ?
          LIMIT ?
        )`,
      )
      .bind(replacement, cutoff, limit)
      .run()
    return result.meta.changes
  },

  deleteAuditLogs: (cutoff, limit) => deleteUpTo(db, 'audit_logs', 'created_at', cutoff, limit),
})
