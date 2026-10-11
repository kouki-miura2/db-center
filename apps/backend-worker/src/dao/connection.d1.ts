import type { ConnectionDao, ConnectionRecord } from 'backend/src/dao/connection.interface.ts'

import { guard, insertAuditLog, limitGuard, runBatch, staleGuard } from './batch.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

export interface ConnectionRow {
  id: string
  product_id: string
  name: string
  connection_string: string
  password_encrypted: string | null
  sort_order: number
  created_at: number
  updated_at: number
}

export const toConnectionRecord = (row: ConnectionRow): ConnectionRecord => ({
  id: row.id,
  productId: row.product_id,
  name: row.name,
  connectionString: row.connection_string,
  passwordEncrypted: row.password_encrypted,
  sortOrder: row.sort_order,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

const revisionAt = (results: D1Result[], index: number) =>
  (results[index]?.results[0] as { revision: number } | undefined)?.revision ?? 0

/** D1 `ConnectionDao`. */
export const createConnectionD1Dao = (db: D1Database): ConnectionDao => ({
  findById: async (productId, connectionId) => {
    const row = await db
      .prepare(
        'SELECT connections.* FROM connections JOIN products ON products.id = connections.product_id WHERE connections.id = ? AND (connections.product_id = ? OR ? IS NULL) AND products.deleted_at IS NULL',
      )
      .bind(connectionId, productId, productId)
      .first<ConnectionRow>()
    return row ? toConnectionRecord(row) : null
  },

  listByProduct: async (productId) => {
    const { results } = await db
      .prepare(
        'SELECT connections.* FROM connections JOIN products ON products.id = connections.product_id WHERE connections.product_id = ? AND products.deleted_at IS NULL ORDER BY connections.sort_order',
      )
      .bind(productId)
      .all<ConnectionRow>()
    return results.map(toConnectionRecord)
  },

  create: async ({ connection, maxConnections, userId, allowedRoles, audit }) => {
    const results = await runBatch(db, [
      actorHasRole(db, connection.productId, userId, allowedRoles),
      db
        .prepare(
          'INSERT INTO connections (id, product_id, name, connection_string, password_encrypted, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, (SELECT coalesce(max(sort_order), 0) + 1 FROM connections WHERE product_id = ?), ?, ?) RETURNING *',
        )
        .bind(
          connection.id,
          connection.productId,
          connection.name,
          connection.connectionString,
          connection.passwordEncrypted,
          connection.productId,
          connection.createdAt,
          connection.updatedAt,
        ),
      limitGuard(
        db,
        '(SELECT count(*) FROM connections WHERE product_id = ?) > ?',
        connection.productId,
        maxConnections,
      ),
      bumpProductRevision(db, connection.productId),
      insertAuditLog(db, audit),
    ])
    return {
      connection: toConnectionRecord(results[1]?.results[0] as ConnectionRow),
      productRevision: revisionAt(results, 3),
    }
  },

  update: async (input) => {
    const keepPassword = input.passwordEncrypted === undefined
    const results = await runBatch(db, [
      actorHasRole(db, input.productId, input.userId, input.allowedRoles),
      db
        .prepare(
          "UPDATE connections SET name = ?, connection_string = ?, password_encrypted = CASE WHEN ? THEN password_encrypted ELSE ? END, updated_at = max(?, updated_at + 1) WHERE id = ? AND product_id = ? AND updated_at = ? AND NOT EXISTS(SELECT 1 FROM deployments WHERE connection_id=connections.id AND status='running') RETURNING *",
        )
        .bind(
          input.name,
          input.connectionString,
          keepPassword ? 1 : 0,
          keepPassword ? null : input.passwordEncrypted,
          input.now,
          input.connectionId,
          input.productId,
          input.expectedUpdatedAt,
        ),
      staleGuard(db),
      bumpProductRevision(db, input.productId),
      insertAuditLog(db, input.audit),
    ])
    return {
      connection: toConnectionRecord(results[1]?.results[0] as ConnectionRow),
      productRevision: revisionAt(results, 3),
    }
  },

  delete: async ({ productId, connectionId, expectedUpdatedAt, userId, allowedRoles, audit }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      // deployments.connection_id is set to NULL by its foreign key; connection_name stays.
      db
        .prepare(
          'UPDATE databases SET revision=revision+1 WHERE id IN (SELECT database_id FROM deployments WHERE connection_id=?)',
        )
        .bind(connectionId),
      // Its deployments change (no connection any more): they record the new database revision.
      db
        .prepare(
          'UPDATE deployments SET revision=(SELECT revision FROM databases WHERE id=deployments.database_id) WHERE connection_id=?',
        )
        .bind(connectionId),
      db
        .prepare(
          "DELETE FROM connections WHERE id = ? AND product_id = ? AND updated_at = ? AND NOT EXISTS(SELECT 1 FROM deployments WHERE connection_id=connections.id AND status='running')",
        )
        .bind(connectionId, productId, expectedUpdatedAt),
      staleGuard(db),
      bumpProductRevision(db, productId),
      insertAuditLog(db, audit),
    ])
    return { productRevision: revisionAt(results, 5) }
  },

  reorder: async ({ productId, connectionIds, expectedRevision, userId, allowedRoles, audit }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      db
        .prepare(
          'UPDATE products SET revision = revision + 1 WHERE id = ? AND revision = ? RETURNING revision',
        )
        .bind(productId, expectedRevision),
      staleGuard(db),
      // Every given ID must be one of the product's connections ...
      ...connectionIds.flatMap((id, index) => [
        db
          .prepare('UPDATE connections SET sort_order = ? WHERE id = ? AND product_id = ?')
          .bind(index + 1, id, productId),
        staleGuard(db),
      ]),
      // ... and all of them, each once.
      guard(
        db,
        'stale_update',
        '(SELECT count(*) FROM connections WHERE product_id = ?) <> ? OR ? <> ?',
        productId,
        connectionIds.length,
        new Set(connectionIds).size,
        connectionIds.length,
      ),
      insertAuditLog(db, audit),
    ])
    return { productRevision: revisionAt(results, 1) }
  },
})
