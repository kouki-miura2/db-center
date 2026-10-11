import { LIMITS, type Target } from 'utils'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'
import type {
  Member,
  Membership,
  Product,
  ProductRepository,
} from '../repository/product.repository.ts'
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

export interface MemberView {
  userId: string
  name: string
  role: Role
  joinedAt: number
}

/**
 * The product scope ("参照 > データの取得とキャッシュ": プロダクト): the product, the caller's role
 * and the members. Connections, invitations and databases join it as they're built.
 */
export interface ProductScopeView {
  product: ProductView
  role: Role
  members: MemberView[]
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
  getProduct: (input: {
    userId: string
    productId: string
    clientRevision?: number
  }) => Promise<ScopeResult<ProductScopeView>>
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
  /** Owner only; `confirmationName` must be the product's current name. */
  deleteProduct: (input: {
    userId: string
    productId: string
    confirmationName: string
    expectedUpdatedAt: number
  }) => Promise<{ revisions: { products: number } }>
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

const ROLE_ORDER: Record<Role, number> = { owner: 0, manager: 1, member: 2 }

// Owner first, then managers, then members, each by when they joined.
const byRoleThenJoined = (a: Member, b: Member) =>
  ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.joinedAt - b.joinedAt

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

/** The second deletion confirmation ("総論 > 共通ルール > 削除"), checked by the API as well. */
export const assertConfirmationName = (confirmationName: string, name: string): void => {
  if (confirmationName !== name) {
    throw new AppError('invalid_input', {
      fields: { confirmationName: '名前が一致しません' },
    })
  }
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

  getProduct: async ({ userId, productId, clientRevision }) => {
    // The membership read also returns the product's revision: enough to answer "unchanged".
    const { product: current, role } = await requireMembership(deps.products, productId, userId)
    if (current.revision === clientRevision) {
      return { mode: 'unchanged', revision: current.revision }
    }
    const scope = await deps.products.findScope(productId)
    if (!scope) throw new AppError('not_found')
    return {
      mode: 'full',
      revision: scope.product.revision,
      data: {
        product: toView(scope.product),
        role,
        members: scope.members.toSorted(byRoleThenJoined).map((member) => ({ ...member })),
      },
    }
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

  deleteProduct: async ({ userId, productId, confirmationName, expectedUpdatedAt }) => {
    const { product, role } = await requireMembership(deps.products, productId, userId)
    assertAllowed(role, 'deleteProduct')
    assertConfirmationName(confirmationName, product.name)
    const now = Date.now()
    const { productsRevision } = await deps.products.delete({
      productId,
      expectedUpdatedAt,
      now,
      userId,
      allowedRoles: allowedRoles('deleteProduct'),
      audit: auditEntry({
        productId,
        userId,
        action: 'delete',
        summary: product.name,
        createdAt: now,
      }),
    })
    return { revisions: { products: productsRevision } }
  },
})
