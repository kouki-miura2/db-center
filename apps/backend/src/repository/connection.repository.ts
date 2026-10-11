import type { ConnectionDao, ConnectionRecord } from '../dao/connection.interface.ts'

/** A connection as the services see it: whether a password is set, never the password. */
export interface Connection {
  id: string
  productId: string
  name: string
  connectionString: string
  hasPassword: boolean
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface ConnectionRepository {
  /** Internal only. The service must authorize before decrypting or using credentials. */
  findCredentials: (connectionId: string) => Promise<ConnectionRecord | null>
  /** Internal only, like `findCredentials`: a product's connections in display order. */
  listCredentials: (productId: string) => Promise<ConnectionRecord[]>
  findById: (productId: string, connectionId: string) => Promise<Connection | null>
  create: (
    input: Parameters<ConnectionDao['create']>[0],
  ) => Promise<{ connection: Connection; productRevision: number }>
  update: (
    input: Parameters<ConnectionDao['update']>[0],
  ) => Promise<{ connection: Connection; productRevision: number }>
  delete: ConnectionDao['delete']
  reorder: ConnectionDao['reorder']
}

export const toConnection = (record: ConnectionRecord): Connection => ({
  id: record.id,
  productId: record.productId,
  name: record.name,
  connectionString: record.connectionString,
  hasPassword: record.passwordEncrypted !== null,
  sortOrder: record.sortOrder,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
})

export const createConnectionRepository = (dao: ConnectionDao): ConnectionRepository => ({
  findCredentials: (connectionId) => dao.findById(null, connectionId),
  listCredentials: (productId) => dao.listByProduct(productId),
  findById: async (productId, connectionId) => {
    const record = await dao.findById(productId, connectionId)
    return record ? toConnection(record) : null
  },
  create: async (input) => {
    const { connection, productRevision } = await dao.create(input)
    return { connection: toConnection(connection), productRevision }
  },
  update: async (input) => {
    const { connection, productRevision } = await dao.update(input)
    return { connection: toConnection(connection), productRevision }
  },
  delete: (input) => dao.delete(input),
  reorder: (input) => dao.reorder(input),
})
