import { AppError } from '../error.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type {
  MemberRecord,
  MembershipRecord,
  ProductDao,
  ProductRecord,
  Role,
} from './product.interface.ts'
import type { UserRecord } from './user.interface.ts'
import { nextUpdatedAt } from './write.ts'

/** One `product_members` row, keyed by `${productId}:${userId}`. */
export interface MemberRow {
  productId: string
  userId: string
  role: Role
  joinedAt: number
}

const products = (db: MemoryDb) => memoryTable<ProductRecord>(db, 'products')
const members = (db: MemoryDb) => memoryTable<MemberRow>(db, 'product_members')
const users = (db: MemoryDb) => memoryTable<UserRecord>(db, 'users')

export const memberKey = (productId: string, userId: string) => `${productId}:${userId}`

const activeProduct = (db: MemoryDb, productId: string) => {
  const product = products(db).get(productId)
  return product && product.deletedAt === null ? product : undefined
}

const membership = (db: MemoryDb, row: MemberRow): MembershipRecord | null => {
  const product = activeProduct(db, row.productId)
  return product ? { product: { ...product }, role: row.role, joinedAt: row.joinedAt } : null
}

const ownerOf = (db: MemoryDb, productId: string) =>
  [...members(db).values()].find((row) => row.productId === productId && row.role === 'owner')
    ?.userId

// The owner already owns another product (not deleted) of this name.
const ownsName = (db: MemoryDb, ownerId: string, name: string, exceptProductId: string) =>
  [...members(db).values()].some(
    (row) =>
      row.userId === ownerId &&
      row.role === 'owner' &&
      row.productId !== exceptProductId &&
      activeProduct(db, row.productId)?.name === name,
  )

const bumpProductsRevision = (db: MemoryDb, userId: string) => {
  const user = users(db).get(userId)
  if (!user) throw new AppError('stale_update')
  user.productsRevision += 1
  return user.productsRevision
}

/** In-memory `ProductDao` over the shared `MemoryDb`. */
export const createProductMemoryDao = (db: MemoryDb): ProductDao => ({
  findMembership: async (productId, userId) => {
    const row = members(db).get(memberKey(productId, userId))
    return row ? membership(db, row) : null
  },

  findScope: async (productId) => {
    const product = activeProduct(db, productId)
    if (!product) return null
    const list: MemberRecord[] = [...members(db).values()]
      .filter((row) => row.productId === productId)
      .map((row) => ({
        userId: row.userId,
        name: users(db).get(row.userId)?.name ?? '',
        role: row.role,
        joinedAt: row.joinedAt,
      }))
    return { product: { ...product }, members: list }
  },

  findProductsRevision: async (userId) => users(db).get(userId)?.productsRevision ?? null,

  listForUser: async (userId) => ({
    revision: users(db).get(userId)?.productsRevision ?? 1,
    memberships: [...members(db).values()]
      .filter((row) => row.userId === userId)
      .flatMap((row) => membership(db, row) ?? []),
  }),

  create: async ({ product, ownerId, maxProducts, audit }) =>
    atomic(db, () => {
      if (ownsName(db, ownerId, product.name, product.id)) throw new AppError('duplicate')
      products(db).set(product.id, { ...product })
      members(db).set(memberKey(product.id, ownerId), {
        productId: product.id,
        userId: ownerId,
        role: 'owner',
        joinedAt: product.createdAt,
      })
      const count = [...members(db).values()].filter(
        (row) => row.userId === ownerId && activeProduct(db, row.productId),
      ).length
      if (count > maxProducts) throw new AppError('limit_exceeded')
      const productsRevision = bumpProductsRevision(db, ownerId)
      appendAuditLog(db, audit)
      return { productsRevision }
    }),

  rename: async ({ productId, name, expectedUpdatedAt, now, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      const actor = members(db).get(memberKey(productId, userId))
      if (!actor || !allowedRoles.includes(actor.role)) throw new AppError('stale_update')
      const product = assertCurrent(activeProduct(db, productId), expectedUpdatedAt)
      const ownerId = ownerOf(db, productId)
      if (ownerId && ownsName(db, ownerId, name, productId)) throw new AppError('duplicate')
      product.name = name
      product.updatedAt = nextUpdatedAt(now, product.updatedAt)
      product.revision += 1
      let productsRevision = 0
      members(db).forEach((row) => {
        if (row.productId !== productId) return
        const revision = bumpProductsRevision(db, row.userId)
        if (row.userId === userId) productsRevision = revision
      })
      appendAuditLog(db, audit)
      return { product: { ...product }, productsRevision }
    }),

  delete: async ({ productId, expectedUpdatedAt, now, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      const actor = members(db).get(memberKey(productId, userId))
      if (!actor || !allowedRoles.includes(actor.role)) throw new AppError('stale_update')
      const product = assertCurrent(activeProduct(db, productId), expectedUpdatedAt)
      product.deletedAt = now
      product.updatedAt = nextUpdatedAt(now, product.updatedAt)
      product.revision += 1
      let productsRevision = 0
      members(db).forEach((row) => {
        if (row.productId !== productId) return
        const revision = bumpProductsRevision(db, row.userId)
        if (row.userId === userId) productsRevision = revision
      })
      appendAuditLog(db, audit)
      return { productsRevision }
    }),
})
