import type { ObjectDao, ObjectRecord, VersionContext } from 'backend/src/dao/object.interface.ts'

import { guard, insertAuditLog, limitGuard, runBatch, staleGuard } from './batch.ts'
import { toVersionRecord, type VersionRow } from './database.d1.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

type ContextRow = VersionRow & {
  product_id: string
  database_name: string
  target: VersionContext['target']
}
export const CONTEXT_SQL =
  'SELECT v.*, d.product_id, d.name AS database_name, p.target FROM versions v JOIN databases d ON d.id = v.database_id JOIN products p ON p.id = d.product_id WHERE v.id = ? AND d.deleted_at IS NULL AND p.deleted_at IS NULL'
export const toContext = (v: ContextRow): VersionContext => ({
  version: toVersionRecord(v),
  productId: v.product_id,
  databaseName: v.database_name,
  target: v.target,
})
interface ObjectSqlRow {
  id: string
  version_id: string
  object_key: string
  kind: ObjectRecord['kind']
  schema_key: string | null
  name: string
  logical_name: string | null
  definition: string
  updated_by: string
  updated_at: number
  revision: number
  deleted_at: number | null
}
const toRecord = (v: ObjectSqlRow): ObjectRecord => ({
  id: v.id,
  versionId: v.version_id,
  objectKey: v.object_key,
  kind: v.kind,
  schemaKey: v.schema_key,
  name: v.name,
  logicalName: v.logical_name,
  definition: v.definition,
  updatedBy: v.updated_by,
  updatedAt: v.updated_at,
  revision: v.revision,
  deletedAt: v.deleted_at,
})
export const createObjectD1Dao = (db: D1Database): ObjectDao => ({
  findContext: async (id) => {
    const row = await db.prepare(CONTEXT_SQL).bind(id).first<ContextRow>()
    return row ? toContext(row) : null
  },
  findScope: async (id, since) => {
    const [context, rows] = await db.batch([
      db.prepare(CONTEXT_SQL).bind(id),
      db
        .prepare(
          'SELECT o.* FROM objects o JOIN versions v ON v.id = o.version_id WHERE o.version_id = ? AND ((? IS NOT NULL AND ? >= v.compacted_revision AND ? <= v.revision AND o.revision > ?) OR ((? IS NULL OR ? < v.compacted_revision OR ? > v.revision) AND o.deleted_at IS NULL))',
        )
        .bind(
          id,
          since ?? null,
          since ?? null,
          since ?? null,
          since ?? null,
          since ?? null,
          since ?? null,
          since ?? null,
        ),
    ])
    const row = context?.results[0] as ContextRow | undefined
    return row
      ? {
          context: toContext(row),
          objects: ((rows?.results ?? []) as ObjectSqlRow[]).map(toRecord),
        }
      : null
  },
  save: async (input) => {
    const { record: r, context: c } = input
    const versionId = c.version.id
    const statements = [
      actorHasRole(db, c.productId, input.userId, input.allowedRoles),
      guard(
        db,
        'stale_update',
        "NOT EXISTS(SELECT 1 FROM versions v JOIN databases d ON d.id = v.database_id WHERE v.id = ? AND v.status = 'editing' AND d.product_id = ? AND d.deleted_at IS NULL)",
        versionId,
        c.productId,
      ),
    ]
    if (input.expectedRevision !== undefined)
      statements.push(
        guard(
          db,
          'stale_update',
          '(SELECT revision FROM versions WHERE id = ?) <> ?',
          versionId,
          input.expectedRevision,
        ),
      )
    if (!input.delete && r.schemaKey)
      statements.push(
        guard(
          db,
          'stale_update',
          "NOT EXISTS(SELECT 1 FROM objects WHERE version_id = ? AND object_key = ? AND kind = 'schema' AND deleted_at IS NULL)",
          versionId,
          r.schemaKey,
        ),
      )
    if (input.delete && r.kind === 'schema')
      statements.push(
        guard(
          db,
          'stale_update',
          'EXISTS(SELECT 1 FROM objects WHERE version_id = ? AND schema_key = ? AND deleted_at IS NULL)',
          versionId,
          r.objectKey,
        ),
      )
    // Subtract the prior active definition before replacing it; rollback restores this on a conflict.
    statements.push(
      db
        .prepare(
          "UPDATE versions SET definition_bytes = definition_bytes - coalesce((SELECT length(CAST(definition AS BLOB)) FROM objects WHERE version_id = ? AND object_key = ? AND deleted_at IS NULL), 0), schema_count = schema_count - coalesce((SELECT kind = 'schema' FROM objects WHERE version_id = ? AND object_key = ? AND deleted_at IS NULL), 0), table_count = table_count - coalesce((SELECT kind = 'table' FROM objects WHERE version_id = ? AND object_key = ? AND deleted_at IS NULL), 0), revision = revision + 1, updated_at = max(?, updated_at + 1) WHERE id = ?",
        )
        .bind(
          versionId,
          r.objectKey,
          versionId,
          r.objectKey,
          versionId,
          r.objectKey,
          input.now,
          versionId,
        ),
    )
    const objectIndex = statements.length
    if (input.expectedUpdatedAt === null) {
      statements.push(
        db
          .prepare(
            'INSERT INTO objects (id, version_id, object_key, kind, schema_key, name, logical_name, definition, updated_by, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT revision FROM versions WHERE id = ?)) RETURNING *',
          )
          .bind(
            r.id,
            versionId,
            r.objectKey,
            r.kind,
            r.schemaKey,
            r.name,
            r.logicalName,
            r.definition,
            input.userId,
            input.now,
            versionId,
          ),
      )
    } else {
      statements.push(
        db
          .prepare(
            'UPDATE objects SET schema_key = ?, name = ?, logical_name = ?, definition = ?, updated_by = ?, updated_at = max(?, updated_at + 1), revision = (SELECT revision FROM versions WHERE id = ?), deleted_at = ? WHERE version_id = ? AND object_key = ? AND kind = ? AND updated_at = ? AND deleted_at IS NULL RETURNING *',
          )
          .bind(
            r.schemaKey,
            r.name,
            r.logicalName,
            r.definition,
            input.userId,
            input.now,
            versionId,
            input.delete ? input.now : null,
            versionId,
            r.objectKey,
            r.kind,
            input.expectedUpdatedAt,
          ),
        staleGuard(db),
      )
    }
    const versionIndex = statements.length
    statements.push(
      db
        .prepare(
          'UPDATE versions SET definition_bytes = definition_bytes + ?, schema_count = schema_count + ?, table_count = table_count + ? WHERE id = ? RETURNING revision',
        )
        .bind(
          input.delete ? 0 : new TextEncoder().encode(r.definition).length,
          !input.delete && r.kind === 'schema' ? 1 : 0,
          !input.delete && r.kind === 'table' ? 1 : 0,
          versionId,
        ),
      limitGuard(
        db,
        '(SELECT count(*) FROM objects WHERE version_id = ? AND deleted_at IS NULL) > ? OR (SELECT definition_bytes FROM versions WHERE id = ?) > ?',
        versionId,
        input.maxObjects,
        versionId,
        input.maxBytes,
      ),
    )
    const databaseIndex = statements.length
    statements.push(
      db
        .prepare(
          'UPDATE databases SET revision = revision + 1, updated_at = max(?, updated_at + 1) WHERE id = ? RETURNING revision',
        )
        .bind(input.now, c.version.databaseId),
    )
    const productIndex = statements.length
    statements.push(bumpProductRevision(db, c.productId), insertAuditLog(db, input.audit))
    const result = await runBatch(db, statements)
    const revision = (index: number) => (result[index]!.results[0] as { revision: number }).revision
    return {
      object: toRecord(result[objectIndex]?.results[0] as ObjectSqlRow),
      revisions: {
        version: revision(versionIndex),
        database: revision(databaseIndex),
        product: revision(productIndex),
      },
    }
  },
})
