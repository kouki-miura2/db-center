import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type {
  MemberRecord,
  MembershipRecord,
  ProductDao,
  ProductRecord,
  Role,
} from '../dao/product.interface.ts'
import { type Connection, toConnection } from './connection.repository.ts'

/** A product that isn't deleted, as the services see it. */
export interface Product {
  id: string
  name: string
  target: ProductRecord['target']
  createdAt: number
  updatedAt: number
  revision: number
}

export interface Membership {
  product: Product
  role: Role
  joinedAt: number
}

export type Member = MemberRecord

export interface ProductRepository {
  findMembership: (productId: string, userId: string) => Promise<Membership | null>
  findScope: (
    productId: string,
  ) => Promise<{ product: Product; members: Member[]; connections: Connection[] } | null>
  findProductsRevision: (userId: string) => Promise<number | null>
  listForUser: (userId: string) => Promise<{ revision: number; memberships: Membership[] }>
  create: (input: {
    product: Product
    ownerId: string
    maxProducts: number
    audit: AuditLogRecord
  }) => Promise<{ productsRevision: number }>
  rename: (input: {
    productId: string
    name: string
    expectedUpdatedAt: number
    now: number
    userId: string
    allowedRoles: Role[]
    audit: AuditLogRecord
  }) => Promise<{ product: Product; productsRevision: number }>
  delete: ProductDao['delete']
}

const toProduct = (record: ProductRecord): Product => ({
  id: record.id,
  name: record.name,
  target: record.target,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  revision: record.revision,
})

const toMembership = (record: MembershipRecord): Membership => ({
  product: toProduct(record.product),
  role: record.role,
  joinedAt: record.joinedAt,
})

export const createProductRepository = (dao: ProductDao): ProductRepository => ({
  findMembership: async (productId, userId) => {
    const record = await dao.findMembership(productId, userId)
    return record ? toMembership(record) : null
  },
  findScope: async (productId) => {
    const scope = await dao.findScope(productId)
    return scope
      ? {
          product: toProduct(scope.product),
          members: scope.members,
          connections: scope.connections.map(toConnection),
        }
      : null
  },
  findProductsRevision: (userId) => dao.findProductsRevision(userId),
  listForUser: async (userId) => {
    const { revision, memberships } = await dao.listForUser(userId)
    return { revision, memberships: memberships.map(toMembership) }
  },
  create: ({ product, ...input }) =>
    dao.create({ ...input, product: { ...product, deletedAt: null } }),
  rename: async (input) => {
    const { product, productsRevision } = await dao.rename(input)
    return { product: toProduct(product), productsRevision }
  },
  delete: (input) => dao.delete(input),
})
