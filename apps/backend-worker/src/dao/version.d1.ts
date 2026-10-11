import type { VersionDao, ApplicationRecord } from 'backend/src/dao/version.interface.ts'

import { guard, insertAuditLog, runBatch, staleGuard } from './batch.ts'
import { toVersionRecord, type VersionRow } from './database.d1.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

export const createVersionD1Dao = (db: D1Database): VersionDao => ({
  applications: async (id) =>
    (
      await db
        .prepare(
          'SELECT id, connection_name AS connectionName, status FROM deployments WHERE to_version_id = ?',
        )
        .bind(id)
        .all<ApplicationRecord>()
    ).results,
  transition: async (input) => {
    const c = input.context
    const results = await runBatch(db, [
      actorHasRole(db, c.productId, input.userId, input.allowedRoles),
      guard(
        db,
        'stale_update',
        'NOT EXISTS (SELECT 1 FROM databases WHERE id = ? AND product_id = ? AND deleted_at IS NULL)',
        c.version.databaseId,
        c.productId,
      ),
      guard(
        db,
        'stale_update',
        "EXISTS (SELECT 1 FROM deployments WHERE to_version_id = ? AND (status = 'running' OR (? AND status = 'succeeded')))",
        c.version.id,
        input.to === 'editing' && !input.acknowledgeApplied ? 1 : 0,
      ),
      db
        .prepare(
          'UPDATE versions SET status = ?, memo = ?, provisional_at = ?, updated_at = max(?, updated_at + 1), revision = revision + 1 WHERE id = ? AND status = ? AND updated_at = ? AND revision = ? RETURNING *',
        )
        .bind(
          input.to,
          input.memo,
          input.to === 'provisional' ? input.now : null,
          input.now,
          c.version.id,
          input.to === 'provisional' ? 'editing' : 'provisional',
          input.expectedUpdatedAt,
          input.expectedRevision,
        ),
      staleGuard(db),
      db
        .prepare(
          'UPDATE databases SET revision = revision + 1, updated_at = max(?, updated_at + 1) WHERE id = ? RETURNING revision',
        )
        .bind(input.now, c.version.databaseId),
      bumpProductRevision(db, c.productId),
      insertAuditLog(db, input.audit),
    ])
    const version = toVersionRecord(results[3]!.results[0] as VersionRow)
    return {
      version,
      revisions: {
        version: version.revision,
        database: (results[5]!.results[0] as { revision: number }).revision,
        product: (results[6]!.results[0] as { revision: number }).revision,
      },
    }
  },
})
