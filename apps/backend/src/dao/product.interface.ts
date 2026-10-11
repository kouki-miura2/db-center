import type { Target } from 'utils'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { ConnectionRecord } from './connection.interface.ts'
import type { InvitationRecord } from './invitation.interface.ts'

export type Role = 'owner' | 'manager' | 'member'

/** One `products` row. */
export interface ProductRecord {
  id: string
  name: string
  target: Target
  createdAt: number
  updatedAt: number
  revision: number
  deletedAt: number | null
}

/** A user's membership of a product that isn't deleted. */
export interface MembershipRecord {
  product: ProductRecord
  role: Role
  joinedAt: number
}

/** A member of a product, with the name to show. */
export interface MemberRecord {
  userId: string
  name: string
  role: Role
  joinedAt: number
}

export interface ProductScopeRecord {
  product: ProductRecord
  members: MemberRecord[]
  connections: ConnectionRecord[]
  /** Every invitation row, expired ones included until they're cleaned up. */
  invitations: InvitationRecord[]
}

export interface ProductDao {
  /** The user's membership of the product, or null if they aren't a member or it's deleted. */
  findMembership: (productId: string, userId: string) => Promise<MembershipRecord | null>
  /**
   * The product scope: the product, its members and connections, read together so they match its
   * revision. Null if the product is deleted or doesn't exist.
   */
  findScope: (productId: string) => Promise<ProductScopeRecord | null>
  /** The user's product list revision (`users.products_revision`), reading that one row only. */
  findProductsRevision: (userId: string) => Promise<number | null>
  /** The user's product list and its revision, read together so they match. */
  listForUser: (userId: string) => Promise<{ revision: number; memberships: MembershipRecord[] }>
  /**
   * Creates a product owned by `ownerId`, with the owner's membership, the audit log entry and the
   * owner's product list revision. Throws `duplicate` if the owner already owns a product of that
   * name (deleted ones aside) and `limit_exceeded` if they'd belong to more than `maxProducts`.
   */
  create: (input: {
    product: ProductRecord
    ownerId: string
    maxProducts: number
    audit: AuditLogRecord
  }) => Promise<{ productsRevision: number }>
  /**
   * Renames a product with optimistic locking, bumping its revision and every member's product
   * list revision, with the audit log entry. Throws `stale_update` if it changed or was deleted
   * since `expectedUpdatedAt`, or if `userId` no longer has one of `allowedRoles`; `duplicate` if
   * its owner already owns another product of that name.
   */
  rename: (input: {
    productId: string
    name: string
    expectedUpdatedAt: number
    now: number
    userId: string
    allowedRoles: Role[]
    audit: AuditLogRecord
  }) => Promise<{ product: ProductRecord; productsRevision: number }>
  /**
   * Marks a product deleted with optimistic locking, bumping every member's product list revision,
   * with the audit log entry. Its databases and everything under them become unreachable with it.
   * Throws `stale_update` if it changed or was deleted since `expectedUpdatedAt`, or if `userId`
   * no longer has one of `allowedRoles`.
   */
  delete: (input: {
    productId: string
    expectedUpdatedAt: number
    now: number
    userId: string
    allowedRoles: Role[]
    audit: AuditLogRecord
  }) => Promise<{ productsRevision: number }>
}
