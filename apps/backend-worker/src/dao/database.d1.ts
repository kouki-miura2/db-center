import type {
  DatabaseDao,
  DatabaseRecord,
  DatabaseSummaryRecord,
  VersionRecord,
  VersionStatus,
} from 'backend/src/dao/database.interface.ts'

import { insertAuditLog, limitGuard, runBatch, staleGuard } from './batch.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

interface DatabaseRow {
  id: string
  product_id: string
  name: string
  description: string | null
  created_at: number
  updated_at: number
  revision: number
  deleted_at: number | null
}

export interface VersionRow {
  id: string
  database_id: string
  number: number
  status: VersionStatus
  source_version_id: string | null
  memo: string | null
  provisional_at: number | null
  finalized_at: number | null
  created_at: number
  updated_at: number
  revision: number
  compacted_revision: number
  schema_count: number
  table_count: number
  definition_bytes: number
}

export const toVersionRecord = (row: VersionRow): VersionRecord => ({
  id: row.id,
  databaseId: row.database_id,
  number: row.number,
  status: row.status,
  sourceVersionId: row.source_version_id,
  memo: row.memo,
  provisionalAt: row.provisional_at,
  finalizedAt: row.finalized_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revision: row.revision,
  compactedRevision: row.compacted_revision,
  schemaCount: row.schema_count,
  tableCount: row.table_count,
  definitionBytes: row.definition_bytes,
})

// A database that isn't deleted, of a product that isn't deleted. Params: databaseId, productId.
const ACTIVE_DATABASE =
  'SELECT databases.* FROM databases JOIN products ON products.id = databases.product_id WHERE databases.id = ? AND databases.product_id = ? AND databases.deleted_at IS NULL AND products.deleted_at IS NULL'

export type DatabaseSummaryRow = DatabaseRow & {
  version_id: string
  version_number: number
  version_status: VersionStatus
  schema_count: number
  table_count: number
  final_id: string | null
  final_number: number | null
}

const toDatabaseRecord = (row: DatabaseRow): DatabaseRecord => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  description: row.description,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revision: row.revision,
  deletedAt: row.deleted_at,
})

/**
 * The product scope's database list (deleted databases aside), each with its latest and latest
 * final version, found through `versions(database_id, number)`. Param: product ID.
 */
export const selectDatabaseSummaries = (db: D1Database, productId: string) =>
  db
    .prepare(
      `SELECT d.id, d.product_id, d.name, d.description, d.created_at, d.updated_at, d.revision, d.deleted_at,
        v.id AS version_id, v.number AS version_number, v.status AS version_status, v.schema_count, v.table_count,
        f.id AS final_id, f.number AS final_number
      FROM databases d
      JOIN versions v ON v.database_id = d.id
        AND v.number = (SELECT max(number) FROM versions WHERE database_id = d.id)
      LEFT JOIN versions f ON f.database_id = d.id
        AND f.number = (SELECT max(number) FROM versions WHERE database_id = d.id AND status = 'final')
      WHERE d.product_id = ? AND d.deleted_at IS NULL`,
    )
    .bind(productId)

export const toDatabaseSummary = (row: DatabaseSummaryRow): DatabaseSummaryRecord => ({
  database: toDatabaseRecord(row),
  latestVersion: {
    id: row.version_id,
    number: row.version_number,
    status: row.version_status,
    schemaCount: row.schema_count,
    tableCount: row.table_count,
  },
  latestFinalVersion:
    row.final_id === null || row.final_number === null
      ? null
      : { id: row.final_id, number: row.final_number },
})

const revisionAt = (results: D1Result[], index: number) =>
  (results[index]?.results[0] as { revision: number } | undefined)?.revision ?? 0

/** D1 `DatabaseDao` (databases, and the v1 and schema a new database starts with). */
export const createDatabaseD1Dao = (db: D1Database): DatabaseDao => ({
  findById: async (productId, databaseId) => {
    const row = await db.prepare(ACTIVE_DATABASE).bind(databaseId, productId).first<DatabaseRow>()
    return row ? toDatabaseRecord(row) : null
  },

  findScope: async (productId, databaseId) => {
    // One batch is one transaction, so the versions match the database's revision.
    const [database, versions] = await db.batch([
      db.prepare(ACTIVE_DATABASE).bind(databaseId, productId),
      db.prepare('SELECT * FROM versions WHERE database_id = ?').bind(databaseId),
    ])
    const row = database?.results[0] as
      | (DatabaseRow & { common_columns: string | null })
      | undefined
    if (!row) return null
    return {
      database: toDatabaseRecord(row),
      commonColumns: row.common_columns,
      versions: ((versions?.results ?? []) as VersionRow[]).map(toVersionRecord),
    }
  },

  create: async ({ database, versionId, schema, maxDatabases, userId, allowedRoles, audit }) => {
    const statements = [
      actorHasRole(db, database.productId, userId, allowedRoles),
      // A name already in use fails the partial UNIQUE index (`duplicate`).
      db
        .prepare(
          'INSERT INTO databases (id, product_id, name, description, created_at, updated_at, revision, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          database.id,
          database.productId,
          database.name,
          database.description,
          database.createdAt,
          database.updatedAt,
          database.revision,
          database.deletedAt,
        ),
      limitGuard(
        db,
        '(SELECT count(*) FROM databases WHERE product_id = ? AND deleted_at IS NULL) > ?',
        database.productId,
        maxDatabases,
      ),
      db
        .prepare(
          "INSERT INTO versions (id, database_id, number, status, created_at, updated_at, schema_count, definition_bytes) VALUES (?, ?, 1, 'editing', ?, ?, ?, coalesce(length(CAST(? AS BLOB)), 0))",
        )
        .bind(
          versionId,
          database.id,
          database.createdAt,
          database.createdAt,
          schema ? 1 : 0,
          // UTF-8 bytes, as a BLOB's length counts them.
          schema?.definition ?? null,
        ),
      ...(schema
        ? [
            db
              .prepare(
                "INSERT INTO objects (id, version_id, object_key, kind, schema_key, name, logical_name, definition, updated_by, updated_at, revision) VALUES (?, ?, ?, 'schema', NULL, ?, NULL, ?, ?, ?, 1)",
              )
              .bind(
                schema.id,
                versionId,
                schema.objectKey,
                schema.name,
                schema.definition,
                userId,
                database.createdAt,
              ),
          ]
        : []),
      bumpProductRevision(db, database.productId),
      insertAuditLog(db, audit),
    ]
    const results = await runBatch(db, statements)
    return { productRevision: revisionAt(results, statements.length - 2) }
  },

  update: async (input) => {
    const results = await runBatch(db, [
      actorHasRole(db, input.productId, input.userId, input.allowedRoles),
      db
        .prepare(
          'UPDATE databases SET name = ?, description = ?, updated_at = max(?, updated_at + 1), revision = revision + 1 WHERE id = ? AND product_id = ? AND updated_at = ? AND deleted_at IS NULL RETURNING *',
        )
        .bind(
          input.name,
          input.description,
          input.now,
          input.databaseId,
          input.productId,
          input.expectedUpdatedAt,
        ),
      staleGuard(db),
      bumpProductRevision(db, input.productId),
      insertAuditLog(db, input.audit),
    ])
    return {
      database: toDatabaseRecord(results[1]?.results[0] as DatabaseRow),
      productRevision: revisionAt(results, 3),
    }
  },

  saveCommonColumns: async (input) => {
    const results = await runBatch(db, [
      actorHasRole(db, input.productId, input.userId, input.allowedRoles),
      db
        .prepare(
          'UPDATE databases SET common_columns = ?, revision = revision + 1 WHERE id = ? AND product_id = ? AND revision = ? AND deleted_at IS NULL RETURNING revision',
        )
        .bind(input.commonColumns, input.databaseId, input.productId, input.expectedRevision),
      staleGuard(db),
    ])
    return { revision: revisionAt(results, 1) }
  },

  delete: async ({
    productId,
    databaseId,
    expectedUpdatedAt,
    now,
    userId,
    allowedRoles,
    audit,
  }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      db
        .prepare(
          'UPDATE databases SET deleted_at = ?, updated_at = max(?, updated_at + 1), revision = revision + 1 WHERE id = ? AND product_id = ? AND updated_at = ? AND deleted_at IS NULL',
        )
        .bind(now, now, databaseId, productId, expectedUpdatedAt),
      staleGuard(db),
      bumpProductRevision(db, productId),
      insertAuditLog(db, audit),
    ])
    return { productRevision: revisionAt(results, 3) }
  },
})
