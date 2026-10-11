import type {
  VersionDao,
  ApplicationRecord,
  VersionWrite,
} from 'backend/src/dao/version.interface.ts'

import { guard, insertAuditLog, runBatch, staleGuard } from './batch.ts'
import { copyD1Objects, toVersionRecord, type VersionRow } from './database.d1.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

const cloneStatements = (db: D1Database, input: VersionWrite, id: string) => [
  guard(
    db,
    'stale_update',
    "EXISTS (SELECT 1 FROM versions WHERE database_id = ? AND status <> 'final') OR NOT EXISTS (SELECT 1 FROM versions WHERE id = ? AND database_id = ? AND status = 'final')",
    input.context.version.databaseId,
    input.context.version.id,
    input.context.version.databaseId,
  ),
  db
    .prepare(`INSERT INTO versions (id,database_id,number,status,source_version_id,created_at,updated_at,schema_count,table_count,definition_bytes)
    SELECT ?,database_id,(SELECT max(number)+1 FROM versions WHERE database_id = v.database_id),'editing',id,?,?,schema_count,table_count,definition_bytes FROM versions v WHERE id = ? RETURNING *`)
    .bind(id, input.now, input.now, input.context.version.id),
  copyD1Objects(db, input.context.version.id, id, input.userId, input.now),
]
const accessStatements = (db: D1Database, input: VersionWrite) => [
  actorHasRole(db, input.context.productId, input.userId, input.allowedRoles),
  guard(
    db,
    'stale_update',
    'NOT EXISTS (SELECT 1 FROM databases WHERE id = ? AND product_id = ? AND deleted_at IS NULL)',
    input.context.version.databaseId,
    input.context.productId,
  ),
]
const parentStatements = (db: D1Database, input: VersionWrite) => [
  db
    .prepare(
      'UPDATE databases SET revision = revision + 1, updated_at = max(?, updated_at + 1) WHERE id = ? RETURNING revision',
    )
    .bind(input.now, input.context.version.databaseId),
  bumpProductRevision(db, input.context.productId),
]

export const createVersionD1Dao = (db: D1Database): VersionDao => ({
  finalize: async (input) => {
    const statements = [
      ...accessStatements(db, input),
      db
        .prepare(
          "UPDATE versions SET status = 'final', memo = ?, finalized_at = ?, updated_at = max(?,updated_at+1), revision = revision+1, compacted_revision = revision+1 WHERE id = ? AND status = 'provisional' AND updated_at = ? AND revision = ? RETURNING *",
        )
        .bind(
          input.memo,
          input.now,
          input.now,
          input.context.version.id,
          input.expectedUpdatedAt,
          input.expectedRevision,
        ),
      staleGuard(db),
      db
        .prepare('DELETE FROM objects WHERE version_id = ? AND deleted_at IS NOT NULL')
        .bind(input.context.version.id),
      ...(input.next ? cloneStatements(db, input, input.next.id) : []),
      ...parentStatements(db, input),
      insertAuditLog(db, input.audit),
      ...(input.next ? [insertAuditLog(db, input.next.audit)] : []),
    ]
    const results = await runBatch(db, statements)
    const version = toVersionRecord(results[2]!.results[0] as VersionRow)
    const parentIndex = input.next ? 8 : 5
    return {
      version,
      createdVersion: input.next ? toVersionRecord(results[6]!.results[0] as VersionRow) : null,
      revisions: {
        version: version.revision,
        database: (results[parentIndex]!.results[0] as { revision: number }).revision,
        product: (results[parentIndex + 1]!.results[0] as { revision: number }).revision,
      },
    }
  },
  create: async (input) => {
    const results = await runBatch(db, [
      ...accessStatements(db, input),
      guard(
        db,
        'stale_update',
        'NOT EXISTS (SELECT 1 FROM versions WHERE id = ? AND updated_at = ? AND revision = ?)',
        input.context.version.id,
        input.expectedUpdatedAt,
        input.expectedRevision,
      ),
      ...cloneStatements(db, input, input.clone.id),
      ...parentStatements(db, input),
      insertAuditLog(db, input.clone.audit),
    ])
    const version = toVersionRecord(results[4]!.results[0] as VersionRow)
    return {
      version,
      revisions: {
        version: 1,
        database: (results[6]!.results[0] as { revision: number }).revision,
        product: (results[7]!.results[0] as { revision: number }).revision,
      },
    }
  },
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
