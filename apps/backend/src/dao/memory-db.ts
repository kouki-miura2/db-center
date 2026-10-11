import { AppError } from '../error.ts'
import type { AuditLogRecord } from './audit-log.interface.ts'

/**
 * Shared state of the in-memory DAOs: one `Map` per table, keyed by primary key. A write that
 * spans tables goes through `atomic`, so the in-memory DAOs keep the same all-or-nothing contract
 * as a D1 batch (see `write.ts`).
 */
export interface MemoryDb {
  tables: Map<string, Map<string, unknown>>
}

export const createMemoryDb = (): MemoryDb => ({ tables: new Map() })

/** The rows of `name`, created empty on first use. Look it up again on each call; don't keep it. */
export const memoryTable = <T>(db: MemoryDb, name: string): Map<string, T> => {
  let table = db.tables.get(name)
  if (!table) {
    table = new Map()
    db.tables.set(name, table)
  }
  return table as Map<string, T>
}

/**
 * Runs a write synchronously; if it throws, every table goes back to how it was. `fn` must not
 * await: nothing else can run in between, which is what makes it atomic. Rows are copied, so
 * mutate a row only inside `atomic`.
 */
export const atomic = <T>(db: MemoryDb, fn: () => T): T => {
  const snapshot = structuredClone(db.tables)
  try {
    return fn()
  } catch (error) {
    db.tables.clear()
    snapshot.forEach((rows, name) => db.tables.set(name, rows))
    throw error
  }
}

/** Throws `stale_update` unless the row is there with the expected `updated_at` (the D1 guard). */
export const assertCurrent = <T extends { updatedAt: number }>(
  row: T | undefined,
  expectedUpdatedAt: number,
): T => {
  if (!row || row.updatedAt !== expectedUpdatedAt) throw new AppError('stale_update')
  return row
}

export const appendAuditLog = (db: MemoryDb, entry: AuditLogRecord): void => {
  memoryTable<AuditLogRecord>(db, 'audit_logs').set(entry.id, entry)
}
