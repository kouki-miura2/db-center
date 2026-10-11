import { LIMITS } from 'utils'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import { AppError } from '../error.ts'
import type { Connection, ConnectionRepository } from '../repository/connection.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { validateConnectionString } from './connection-string.ts'
import { allowedRoles, assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

/** A connection as the API returns it: the password is never sent, only whether one is set. */
export interface ConnectionView {
  id: string
  name: string
  connectionString: string
  hasPassword: boolean
  sortOrder: number
  updatedAt: number
}

type ProductRevision = { revisions: { product: number } }

export interface ConnectionService {
  createConnection: (input: {
    userId: string
    productId: string
    name: string
    connectionString: string
    password?: string
  }) => Promise<{ connection: ConnectionView } & ProductRevision>
  /** `password` omitted keeps the stored one, null removes it. */
  updateConnection: (input: {
    userId: string
    productId: string
    connectionId: string
    name: string
    connectionString: string
    password?: string | null
    expectedUpdatedAt: number
  }) => Promise<{ connection: ConnectionView } & ProductRevision>
  deleteConnection: (input: {
    userId: string
    productId: string
    connectionId: string
    expectedUpdatedAt: number
  }) => Promise<ProductRevision>
  /** `expectedRevision` is the product scope's revision the client ordered from. */
  reorderConnections: (input: {
    userId: string
    productId: string
    connectionIds: string[]
    expectedRevision: number
  }) => Promise<ProductRevision>
}

export const toConnectionView = (connection: Connection): ConnectionView => ({
  id: connection.id,
  name: connection.name,
  connectionString: connection.connectionString,
  hasPassword: connection.hasPassword,
  sortOrder: connection.sortOrder,
  updatedAt: connection.updatedAt,
})

/**
 * Database connections of a product ("各論 > プロダクト管理"). Passwords are encrypted with the
 * connection's ID as authenticated data and never returned.
 */
export const createConnectionService = (deps: {
  products: ProductRepository
  connections: ConnectionRepository
  secrets: SecretBox
}): ConnectionService => {
  // The caller may edit connections, and the product's target has them.
  const authorize = async (productId: string, userId: string) => {
    const { product, role } = await requireMembership(deps.products, productId, userId)
    assertAllowed(role, 'editConnections')
    if (product.target === 'sqlite3') {
      throw new AppError('invalid_state', {
        message: 'SQLite 3 のプロダクトには接続情報を設定できません',
      })
    }
    return { userId, allowedRoles: allowedRoles('editConnections') }
  }
  const audit = (
    productId: string,
    userId: string,
    action: string,
    summary: string,
    now: number,
  ): AuditLogRecord => ({
    id: crypto.randomUUID(),
    productId,
    userId,
    targetType: 'connection',
    action,
    summary,
    createdAt: now,
  })
  const encrypt = (password: string, connectionId: string) =>
    deps.secrets.encrypt(password, 'connection-password', connectionId)

  return {
    createConnection: async ({ userId, productId, name, connectionString, password }) => {
      const actor = await authorize(productId, userId)
      const now = Date.now()
      const id = crypto.randomUUID()
      const { connection, productRevision } = await deps.connections
        .create({
          ...actor,
          connection: {
            id,
            productId,
            name,
            connectionString: validateConnectionString(connectionString),
            passwordEncrypted: password ? await encrypt(password, id) : null,
            createdAt: now,
            updatedAt: now,
          },
          maxConnections: LIMITS.connectionsPerProduct,
          audit: audit(productId, userId, 'create', name, now),
        })
        .catch((error: unknown) => {
          if (error instanceof AppError && error.code === 'limit_exceeded') {
            throw new AppError('limit_exceeded', {
              message: `接続情報は${LIMITS.connectionsPerProduct}件までです`,
            })
          }
          throw error
        })
      return { connection: toConnectionView(connection), revisions: { product: productRevision } }
    },

    updateConnection: async (input) => {
      const actor = await authorize(input.productId, input.userId)
      const now = Date.now()
      const { connection, productRevision } = await deps.connections.update({
        ...actor,
        productId: input.productId,
        connectionId: input.connectionId,
        name: input.name,
        connectionString: validateConnectionString(input.connectionString),
        passwordEncrypted:
          input.password === undefined || input.password === null
            ? input.password
            : await encrypt(input.password, input.connectionId),
        expectedUpdatedAt: input.expectedUpdatedAt,
        now,
        audit: audit(input.productId, input.userId, 'update', input.name, now),
      })
      return { connection: toConnectionView(connection), revisions: { product: productRevision } }
    },

    deleteConnection: async ({ userId, productId, connectionId, expectedUpdatedAt }) => {
      const actor = await authorize(productId, userId)
      const existing = await deps.connections.findById(productId, connectionId)
      if (!existing) throw new AppError('not_found')
      const now = Date.now()
      const { productRevision } = await deps.connections.delete({
        ...actor,
        productId,
        connectionId,
        expectedUpdatedAt,
        audit: audit(productId, userId, 'delete', existing.name, now),
      })
      return { revisions: { product: productRevision } }
    },

    reorderConnections: async ({ userId, productId, connectionIds, expectedRevision }) => {
      const actor = await authorize(productId, userId)
      const now = Date.now()
      const { productRevision } = await deps.connections.reorder({
        ...actor,
        productId,
        connectionIds,
        expectedRevision,
        audit: audit(productId, userId, 'update', '接続情報の並び順', now),
      })
      return { revisions: { product: productRevision } }
    },
  }
}
