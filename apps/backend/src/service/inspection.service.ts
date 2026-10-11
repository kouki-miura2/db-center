import type { ConnectionRecord } from '../dao/connection.interface.ts'
import { AppError } from '../error.ts'
import type { ConnectionRepository } from '../repository/connection.repository.ts'
import { readPostgresCatalog } from '../repository/postgres-catalog.ts'
import { inspectPostgres, type PostgresAdapter } from '../repository/postgres.interface.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export const createInspectionService = (deps: {
  products: ProductRepository
  connections: ConnectionRepository
  secrets: SecretBox
  postgres: PostgresAdapter
}) => {
  /**
   * Connects to a connection's database and reads its state, without reading D1: the caller has
   * already read the connection and authorized the user for it.
   */
  const inspectConnection = async (connection: ConnectionRecord) => {
    const password =
      connection.passwordEncrypted === null
        ? null
        : await deps.secrets.decrypt(
            connection.passwordEncrypted,
            'connection-password',
            connection.id,
          )
    const session = await deps.postgres.open(connection.connectionString, password)
    try {
      const result = await inspectPostgres(session)
      // Catalog inspection failures also contain only a safe, fixed message.
      return {
        ...result,
        catalog: result.supported ? await readPostgresCatalog(session) : null,
        connectionId: connection.id,
        connectionName: connection.name,
        connectionUpdatedAt: connection.updatedAt,
      }
    } catch {
      throw new AppError('connection_failed')
    } finally {
      await session.close()
    }
  }
  return {
    inspectConnection,
    inspect: async ({ userId, connectionId }: { userId: string; connectionId: string }) => {
      const connection = await deps.connections.findCredentials(connectionId)
      if (!connection) throw new AppError('not_found')
      const member = await requireMembership(deps.products, connection.productId, userId)
      assertAllowed(member.role, 'deploy')
      if (member.product.target !== 'postgresql18') throw new AppError('invalid_input')
      return inspectConnection(connection)
    },
  }
}
export type InspectionService = ReturnType<typeof createInspectionService>
