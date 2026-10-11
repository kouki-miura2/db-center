/**
 * Shared rules for every write, in both the in-memory and the datastore DAOs:
 *
 * - All or nothing: the data, its audit log entry and every revision it bumps are written in one
 *   batch (D1) or one `atomic` call (memory). A conflict found while writing throws
 *   `AppError('stale_update' | 'limit_exceeded' | 'duplicate')` and leaves everything unchanged.
 * - Optimistic locking: an update only applies while the row's `updated_at` still equals the
 *   client's `expectedUpdatedAt`; checking it in the service beforehand isn't enough.
 * - `updated_at` comes from `nextUpdatedAt`, so it always grows, even for two saves in the same
 *   millisecond, and a client never ends up holding a stale value that still matches.
 */

/** The new `updated_at` of a row: now, or one past the previous value if the clock hasn't moved on. In SQL: `max(?now, updated_at + 1)`. */
export const nextUpdatedAt = (now: number, previous: number): number => Math.max(now, previous + 1)
