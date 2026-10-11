import type { AuditLogRecord } from 'backend/src/dao/audit-log.interface.ts'
import { AppError } from 'backend/src/error.ts'

/**
 * Building blocks for D1 writes, following `backend/src/dao/write.ts`: every statement of one
 * write goes into one `runBatch`, which D1 runs as a single transaction. An UPDATE that matches
 * no row isn't an error in SQL, so each conditional UPDATE is followed by `staleGuard`, which
 * fails the batch (and rolls back everything in it) when that UPDATE changed nothing.
 *
 * Optimistic locking, in SQL:
 *   UPDATE t SET ..., updated_at = max(?now, updated_at + 1), revision = revision + 1
 *   WHERE id = ? AND updated_at = ?expectedUpdatedAt [AND deleted_at IS NULL]
 *   RETURNING ...
 */

/** Fails the batch with `stale_update` when the statement right before it changed no row. */
export const staleGuard = (db: D1Database): D1PreparedStatement =>
  db.prepare("INSERT INTO batch_guard SELECT 'stale_update' WHERE changes() = 0")

/**
 * Fails the batch with `limit_exceeded` when `exceededCondition` (an SQL expression, typically
 * `(SELECT count(*) ...) > ?`) is true. Put it after the INSERT it limits, so the count includes it.
 */
export const limitGuard = (
  db: D1Database,
  exceededCondition: string,
  ...params: unknown[]
): D1PreparedStatement =>
  db
    .prepare(`INSERT INTO batch_guard SELECT 'limit_exceeded' WHERE ${exceededCondition}`)
    .bind(...params)

export const insertAuditLog = (db: D1Database, entry: AuditLogRecord): D1PreparedStatement =>
  db
    .prepare(
      'INSERT INTO audit_logs (id, product_id, user_id, target_type, action, summary, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      entry.id,
      entry.productId,
      entry.userId,
      entry.targetType,
      entry.action,
      entry.summary,
      entry.createdAt,
    )

/** Bumps the product list revision of every member of a product (name change, deletion, members). */
export const bumpMembersProductsRevision = (
  db: D1Database,
  productId: string,
): D1PreparedStatement =>
  db
    .prepare(
      'UPDATE users SET products_revision = products_revision + 1 WHERE id IN (SELECT user_id FROM product_members WHERE product_id = ?)',
    )
    .bind(productId)

// D1 puts SQLite's message in `cause` (and usually repeats it in `message`).
const errorText = (error: unknown): string =>
  error instanceof Error
    ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ''}`
    : String(error)

/**
 * Runs the statements as one transaction. A failed guard or a UNIQUE violation becomes the
 * matching `AppError`; anything else is rethrown as is.
 */
export const runBatch = async (db: D1Database, statements: D1PreparedStatement[]) => {
  try {
    return await db.batch(statements)
  } catch (error) {
    const text = errorText(error)
    if (text.includes('CHECK constraint failed: stale_update')) throw new AppError('stale_update')
    if (text.includes('CHECK constraint failed: limit_exceeded'))
      throw new AppError('limit_exceeded')
    if (text.includes('UNIQUE constraint failed')) throw new AppError('duplicate')
    throw error
  }
}
