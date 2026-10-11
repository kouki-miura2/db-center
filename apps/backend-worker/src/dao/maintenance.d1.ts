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

// The table of each kind, and the deployments column pointing at it.
const PURGE = {
  product: { table: 'products', owner: 'product_id' },
  database: { table: 'databases', owner: 'database_id' },
} as const

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

  findPurgeable: async ({ kind, cutoff, after, limit }) => {
    const { table, owner } = PURGE[kind]
    const { results } = await db
      .prepare(
        `SELECT id FROM ${table} WHERE deleted_at IS NOT NULL AND deleted_at <= ? AND id > ? ORDER BY id LIMIT ?`,
      )
      .bind(cutoff, after ?? '', limit)
      .all<{ id: string }>()
    if (results.length === 0) return []
    const deployments = await db
      .prepare(
        `SELECT ${owner} AS owner, id, status FROM deployments WHERE ${owner} IN (SELECT value FROM json_each(?)) ORDER BY id`,
      )
      .bind(JSON.stringify(results.map((row) => row.id)))
      .all<{ owner: string; id: string; status: string }>()
    return results.map((row) => {
      const under = deployments.results.filter((deployment) => deployment.owner === row.id)
      return {
        id: row.id,
        deploymentIds: under.map((deployment) => deployment.id),
        running: under.some((deployment) => deployment.status === 'running'),
      }
    })
  },

  // ON DELETE CASCADE removes everything under the row in this one statement. D1 counts the
  // cascaded rows in `meta.changes` too, so RETURNING tells whether the row itself went.
  purge: async ({ kind, id, cutoff }) => {
    const { table, owner } = PURGE[kind]
    const { results } = await db
      .prepare(
        `DELETE FROM ${table} WHERE id = ? AND deleted_at IS NOT NULL AND deleted_at <= ?
          AND NOT EXISTS (SELECT 1 FROM deployments WHERE ${owner} = ? AND status = 'running')
          RETURNING id`,
      )
      .bind(id, cutoff, id)
      .all()
    return results.length === 1
  },
})
