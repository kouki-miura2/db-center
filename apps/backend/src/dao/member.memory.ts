import { AppError } from '../error.ts'
import type { MemberDao } from './member.interface.ts'
import { appendAuditLog, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import {
  assertActorRole,
  bumpProductRevision,
  bumpProductsRevision,
  memberKey,
  type MemberRow,
} from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

const members = (db: MemoryDb) => memoryTable<MemberRow>(db, 'product_members')

const productsRevisionOf = (db: MemoryDb, userId: string) =>
  memoryTable<UserRecord>(db, 'users').get(userId)?.productsRevision ?? 0

/** In-memory `MemberDao` over the shared `MemoryDb`. */
export const createMemberMemoryDao = (db: MemoryDb): MemberDao => ({
  changeRole: async ({ productId, userId, allowedRoles, audit, targetUserId, from, to }) =>
    atomic(db, () => {
      assertActorRole(db, productId, userId, allowedRoles)
      const target = members(db).get(memberKey(productId, targetUserId))
      if (target?.role !== from) throw new AppError('stale_update')
      target.role = to
      const productRevision = bumpProductRevision(db, productId)
      bumpProductsRevision(db, targetUserId)
      appendAuditLog(db, audit)
      return { productRevision, productsRevision: productsRevisionOf(db, userId) }
    }),

  transferOwnership: async ({ productId, userId, allowedRoles, audit, targetUserId }) =>
    atomic(db, () => {
      const product = assertActorRole(db, productId, userId, allowedRoles)
      const owner = members(db).get(memberKey(productId, userId))
      const target = members(db).get(memberKey(productId, targetUserId))
      if (owner?.role !== 'owner' || !target || target.role === 'owner') {
        throw new AppError('stale_update')
      }
      const products = memoryTable<ProductRecord>(db, 'products')
      const ownsName = [...members(db).values()].some(
        (row) =>
          row.userId === targetUserId &&
          row.role === 'owner' &&
          row.productId !== productId &&
          products.get(row.productId)?.deletedAt === null &&
          products.get(row.productId)?.name === product.name,
      )
      if (ownsName) throw new AppError('duplicate')
      owner.role = 'manager'
      target.role = 'owner'
      const productRevision = bumpProductRevision(db, productId)
      const productsRevision = bumpProductsRevision(db, userId)
      bumpProductsRevision(db, targetUserId)
      appendAuditLog(db, audit)
      return { productRevision, productsRevision }
    }),

  remove: async ({ productId, userId, allowedRoles, audit, targetUserId, targetRoles }) =>
    atomic(db, () => {
      assertActorRole(db, productId, userId, allowedRoles)
      const key = memberKey(productId, targetUserId)
      const target = members(db).get(key)
      if (!target || !targetRoles.includes(target.role)) throw new AppError('stale_update')
      members(db).delete(key)
      const productRevision = bumpProductRevision(db, productId)
      bumpProductsRevision(db, targetUserId)
      appendAuditLog(db, audit)
      return { productRevision, productsRevision: productsRevisionOf(db, userId) }
    }),
})
