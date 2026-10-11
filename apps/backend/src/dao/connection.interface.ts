import type { AuditLogRecord } from './audit-log.interface.ts'
import type { Role } from './product.interface.ts'

/** One `connections` row. `passwordEncrypted` never leaves the backend. */
export interface ConnectionRecord {
  id: string
  productId: string
  name: string
  connectionString: string
  passwordEncrypted: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

/**
 * Who writes and what to log. Every write is refused (`stale_update`) if the actor no longer has
 * one of `allowedRoles` or the product was deleted, and bumps the product's revision.
 */
interface ConnectionWrite {
  userId: string
  allowedRoles: Role[]
  audit: AuditLogRecord
}

export interface ConnectionDao {
  /** A connection of a product that isn't deleted, or null. */
  findById: (productId: string | null, connectionId: string) => Promise<ConnectionRecord | null>
  /** Adds a connection after the others. Throws `limit_exceeded` beyond `maxConnections`. */
  create: (
    input: ConnectionWrite & {
      connection: Omit<ConnectionRecord, 'sortOrder'>
      maxConnections: number
    },
  ) => Promise<{ connection: ConnectionRecord; productRevision: number }>
  /**
   * Changes a connection with optimistic locking. `passwordEncrypted` undefined keeps the stored
   * password, null removes it.
   */
  update: (
    input: ConnectionWrite & {
      productId: string
      connectionId: string
      name: string
      connectionString: string
      passwordEncrypted: string | null | undefined
      expectedUpdatedAt: number
      now: number
    },
  ) => Promise<{ connection: ConnectionRecord; productRevision: number }>
  /** Deletes a connection with optimistic locking. Its deployments keep its name. */
  delete: (
    input: ConnectionWrite & {
      productId: string
      connectionId: string
      expectedUpdatedAt: number
    },
  ) => Promise<{ productRevision: number }>
  /**
   * Puts the product's connections in this order. `connectionIds` must be exactly its connections,
   * and the product still at `expectedRevision`; otherwise `stale_update`.
   */
  reorder: (
    input: ConnectionWrite & {
      productId: string
      connectionIds: string[]
      expectedRevision: number
    },
  ) => Promise<{ productRevision: number }>
}
