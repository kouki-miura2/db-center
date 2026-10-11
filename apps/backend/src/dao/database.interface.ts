import type { AuditLogRecord } from './audit-log.interface.ts'
import type { Role } from './product.interface.ts'

export type VersionStatus = 'editing' | 'provisional' | 'final'

/** One `databases` row. */
export interface DatabaseRecord {
  id: string
  productId: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
  revision: number
  deletedAt: number | null
}

/**
 * A row of the product scope's database list: the database, its latest version (with the counts
 * shown in the list) and its latest final version.
 */
export interface DatabaseSummaryRecord {
  database: DatabaseRecord
  latestVersion: {
    id: string
    number: number
    status: VersionStatus
    schemaCount: number
    tableCount: number
  }
  latestFinalVersion: { id: string; number: number } | null
}

/** The schema an empty database starts with (PostgreSQL's `public`; none on SQLite 3). */
export interface InitialSchema {
  id: string
  objectKey: string
  name: string
  definition: string
}

/**
 * Who writes and what to log. Every write is refused (`stale_update`) if the actor no longer has
 * one of `allowedRoles` or the product was deleted, and bumps the product's revision.
 */
interface DatabaseWrite {
  userId: string
  allowedRoles: Role[]
  audit: AuditLogRecord
}

export interface DatabaseDao {
  /** A database that isn't deleted, of a product that isn't deleted, or null. */
  findById: (productId: string, databaseId: string) => Promise<DatabaseRecord | null>
  /**
   * Creates a database with its v1 (editing) holding `schema`, if any. Throws `duplicate` if a
   * database of the product (deleted ones aside) has the name, and `limit_exceeded` beyond
   * `maxDatabases` (deleted ones aside).
   */
  create: (
    input: DatabaseWrite & {
      database: DatabaseRecord
      versionId: string
      schema: InitialSchema | null
      maxDatabases: number
    },
  ) => Promise<{ productRevision: number }>
  /**
   * Changes the name and description with optimistic locking, bumping the database's revision.
   * Throws `stale_update` if it changed or was deleted since `expectedUpdatedAt`, `duplicate` if
   * another database of the product has the name.
   */
  update: (
    input: DatabaseWrite & {
      productId: string
      databaseId: string
      name: string
      description: string | null
      expectedUpdatedAt: number
      now: number
    },
  ) => Promise<{ database: DatabaseRecord; productRevision: number }>
  /**
   * Marks a database deleted with optimistic locking; its versions and design become unreachable
   * with it. Throws `stale_update` if it changed or was deleted since `expectedUpdatedAt`.
   */
  delete: (
    input: DatabaseWrite & {
      productId: string
      databaseId: string
      expectedUpdatedAt: number
      now: number
    },
  ) => Promise<{ productRevision: number }>
}
