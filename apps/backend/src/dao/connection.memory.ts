import { AppError } from '../error.ts'
import type { ConnectionDao, ConnectionRecord } from './connection.interface.ts'
import type { DeploymentRecord } from './deployment.interface.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { assertActorRole, bumpProductRevision } from './product.memory.ts'
import { nextUpdatedAt } from './write.ts'

const connections = (db: MemoryDb) => memoryTable<ConnectionRecord>(db, 'connections')

const ofProduct = (db: MemoryDb, productId: string) =>
  [...connections(db).values()].filter((row) => row.productId === productId)

const inProduct = (db: MemoryDb, productId: string, connectionId: string) => {
  const row = connections(db).get(connectionId)
  return row?.productId === productId ? row : undefined
}

/** In-memory `ConnectionDao` over the shared `MemoryDb`. */
export const createConnectionMemoryDao = (db: MemoryDb): ConnectionDao => ({
  findById: async (productId, connectionId) => {
    const row = connections(db).get(connectionId)
    if (!row || (productId !== null && row.productId !== productId)) return null
    const product = memoryTable<ProductRecord>(db, 'products').get(row.productId)
    return product && product.deletedAt === null && row ? { ...row } : null
  },

  create: async ({ connection, maxConnections, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      assertActorRole(db, connection.productId, userId, allowedRoles)
      const existing = ofProduct(db, connection.productId)
      if (existing.length + 1 > maxConnections) throw new AppError('limit_exceeded')
      const row: ConnectionRecord = {
        ...connection,
        sortOrder: Math.max(0, ...existing.map((other) => other.sortOrder)) + 1,
      }
      connections(db).set(row.id, row)
      const productRevision = bumpProductRevision(db, connection.productId)
      appendAuditLog(db, audit)
      return { connection: { ...row }, productRevision }
    }),

  update: async (input) =>
    atomic(db, () => {
      assertActorRole(db, input.productId, input.userId, input.allowedRoles)
      const row = assertCurrent(
        inProduct(db, input.productId, input.connectionId),
        input.expectedUpdatedAt,
      )
      row.name = input.name
      if (
        [...memoryTable<DeploymentRecord>(db, 'deployments').values()].some(
          (v) => v.connectionId === row.id && v.status === 'running',
        )
      )
        throw new AppError('invalid_state')
      row.connectionString = input.connectionString
      if (input.passwordEncrypted !== undefined) row.passwordEncrypted = input.passwordEncrypted
      row.updatedAt = nextUpdatedAt(input.now, row.updatedAt)
      const productRevision = bumpProductRevision(db, input.productId)
      appendAuditLog(db, input.audit)
      return { connection: { ...row }, productRevision }
    }),

  delete: async ({ productId, connectionId, expectedUpdatedAt, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      assertActorRole(db, productId, userId, allowedRoles)
      assertCurrent(inProduct(db, productId, connectionId), expectedUpdatedAt)
      connections(db).delete(connectionId)
      const history = memoryTable<DeploymentRecord>(db, 'deployments')
      if (
        [...history.values()].some((v) => v.connectionId === connectionId && v.status === 'running')
      )
        throw new AppError('invalid_state')
      const touched = [...history.values()].filter((v) => v.connectionId === connectionId)
      const databases = memoryTable<{ revision: number }>(db, 'databases')
      new Set(touched.map((v) => v.databaseId)).forEach((id) => {
        const database = databases.get(id)
        if (database) database.revision++
      })
      // Its deployments change (no connection any more): they record the new database revision.
      touched.forEach((v) => {
        v.connectionId = null
        v.revision = databases.get(v.databaseId)?.revision ?? v.revision
      })
      const productRevision = bumpProductRevision(db, productId)
      appendAuditLog(db, audit)
      return { productRevision }
    }),

  reorder: async ({ productId, connectionIds, expectedRevision, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      const product = assertActorRole(db, productId, userId, allowedRoles)
      const current = ofProduct(db, productId).map((row) => row.id)
      const sameSet =
        new Set(connectionIds).size === connectionIds.length &&
        connectionIds.length === current.length &&
        connectionIds.every((id) => current.includes(id))
      if (product.revision !== expectedRevision || !sameSet) throw new AppError('stale_update')
      connectionIds.forEach((id, index) => {
        const row = connections(db).get(id)
        if (row) row.sortOrder = index + 1
      })
      const productRevision = bumpProductRevision(db, productId)
      appendAuditLog(db, audit)
      return { productRevision }
    }),
})
