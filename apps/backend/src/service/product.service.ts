import { LIMITS, type Target } from 'utils'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'
import type { Membership, Product, ProductRepository } from '../repository/product.repository.ts'
import { allowedRoles, assertAllowed } from './permission.ts'

/** One row of the product list ("参照 > データの取得とキャッシュ": プロダクト一覧). */
export interface ProductListItemView {
  id: string
  name: string
  target: Target
  role: Role
  createdAt: number
  joinedAt: number
  /** Sent back as `expectedUpdatedAt` when renaming. */
  updatedAt: number
}

export interface ProductView {
  id: string
  name: string
  target: Target
  createdAt: number
  updatedAt: number
}

/** A cacheable scope: unchanged when the client's revision is current, otherwise all of it. */
export type ScopeResult<T> =
  | { mode: 'unchanged'; revision: number }
  | { mode: 'full'; revision: number; data: T }

export interface ProductService {
  listProducts: (
    userId: string,
    clientRevision?: number,
  ) => Promise<ScopeResult<ProductListItemView[]>>
  createProduct: (input: {
    userId: string
    name: string
    target: Target
  }) => Promise<{ product: ProductListItemView; revisions: { products: number } }>
  renameProduct: (input: {
    userId: string
    productId: string
    name: string
    expectedUpdatedAt: number
  }) => Promise<{ product: ProductView; revisions: { products: number; product: number } }>
}

const toListItem = ({ product, role, joinedAt }: Membership): ProductListItemView => ({
  id: product.id,
  name: product.name,
  target: product.target,
  role,
  createdAt: product.createdAt,
  joinedAt,
  updatedAt: product.updatedAt,
})

const toView = ({ id, name, target, createdAt, updatedAt }: Product): ProductView => ({
  id,
  name,
  target,
  createdAt,
  updatedAt,
})

const auditEntry = (entry: Omit<AuditLogRecord, 'id' | 'targetType'>): AuditLogRecord => ({
  id: crypto.randomUUID(),
  targetType: 'product',
  ...entry,
})

// Rewords the DAO's generic conflicts for the user.
const explain = (error: unknown): never => {
  if (error instanceof AppError && error.code === 'duplicate') {
    throw new AppError('duplicate', { message: '同じ名前のプロダクトがすでにあります' })
  }
  if (error instanceof AppError && error.code === 'limit_exceeded') {
    throw new AppError('limit_exceeded', {
      message: `参加できるプロダクトは${LIMITS.productsPerUser}件までです`,
    })
  }
  throw error
}

/**
 * The membership a request acts through: not a member, or a deleted product, is `not_found`, so
 * the product's existence isn't revealed.
 */
export const requireMembership = async (
  products: ProductRepository,
  productId: string,
  userId: string,
): Promise<Membership> => {
  const membership = await products.findMembership(productId, userId)
  if (!membership) throw new AppError('not_found')
  return membership
}

/** Products and the product list ("各論 > プロダクト管理"). */
export const createProductService = (deps: { products: ProductRepository }): ProductService => ({
  listProducts: async (userId, clientRevision) => {
    // Read the one revision row first; the list only when the client's copy is out of date.
    const current = await deps.products.findProductsRevision(userId)
    if (current !== null && current === clientRevision) {
      return { mode: 'unchanged', revision: current }
    }
    const { revision, memberships } = await deps.products.listForUser(userId)
    const data = memberships
      .map(toListItem)
      .sort((a, b) => a.name.localeCompare(b.name, 'ja') || a.id.localeCompare(b.id))
    return { mode: 'full', revision, data }
  },

  createProduct: async ({ userId, name, target }) => {
    const now = Date.now()
    const product: Product = {
      id: crypto.randomUUID(),
      name,
      target,
      createdAt: now,
      updatedAt: now,
      revision: 1,
    }
    const { productsRevision } = await deps.products
      .create({
        product,
        ownerId: userId,
        maxProducts: LIMITS.productsPerUser,
        audit: auditEntry({
          productId: product.id,
          userId,
          action: 'create',
          summary: name,
          createdAt: now,
        }),
      })
      .catch(explain)
    return {
      product: toListItem({ product, role: 'owner', joinedAt: now }),
      revisions: { products: productsRevision },
    }
  },

  renameProduct: async ({ userId, productId, name, expectedUpdatedAt }) => {
    const { product: current, role } = await requireMembership(deps.products, productId, userId)
    assertAllowed(role, 'renameProduct')
    const now = Date.now()
    const { product, productsRevision } = await deps.products
      .rename({
        productId,
        name,
        expectedUpdatedAt,
        now,
        userId,
        allowedRoles: allowedRoles('renameProduct'),
        audit: auditEntry({
          productId,
          userId,
          action: 'update',
          summary: `${current.name} → ${name}`,
          createdAt: now,
        }),
      })
      .catch(explain)
    return {
      product: toView(product),
      revisions: { products: productsRevision, product: product.revision },
    }
  },
})
