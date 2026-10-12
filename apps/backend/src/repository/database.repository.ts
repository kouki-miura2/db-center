import type {
  DatabaseDao,
  DatabaseRecord,
  DatabaseSummaryRecord,
  VersionRecord,
} from '../dao/database.interface.ts'

/** A database that isn't deleted, as the services see it. */
export interface Database {
  id: string
  productId: string
  name: string
  description: string | null
  createdAt: number
  updatedAt: number
  revision: number
}

export type Version = VersionRecord

import type { DeploymentReadRecord } from '../dao/deployment.interface.ts'
export interface DatabaseScope {
  database: Database
  /** The common column set, in order; empty if none is defined. */
  commonColumns: unknown[]
  versions: Version[]
  deployments?: DeploymentReadRecord[]
}

export type DatabaseSummary = Omit<DatabaseSummaryRecord, 'database'> & { database: Database }

export interface DatabaseRepository {
  findVersion: DatabaseDao['findVersion']
  findById: (productId: string, databaseId: string) => Promise<Database | null>
  findScope: (
    productId: string,
    databaseId: string,
    options?: Parameters<DatabaseDao['findScope']>[2],
  ) => Promise<DatabaseScope | null>
  create: (
    input: Omit<Parameters<DatabaseDao['create']>[0], 'database'> & { database: Database },
  ) => Promise<{ productRevision: number }>
  update: (
    input: Parameters<DatabaseDao['update']>[0],
  ) => Promise<{ database: Database; productRevision: number }>
  /** Stores the common column set as JSON. */
  saveCommonColumns: (
    input: Omit<Parameters<DatabaseDao['saveCommonColumns']>[0], 'commonColumns'> & {
      commonColumns: unknown[]
    },
  ) => Promise<{ revision: number }>
  delete: DatabaseDao['delete']
}

export const toDatabase = (record: DatabaseRecord): Database => ({
  id: record.id,
  productId: record.productId,
  name: record.name,
  description: record.description,
  createdAt: record.createdAt,
  updatedAt: record.updatedAt,
  revision: record.revision,
})

export const toDatabaseSummary = (record: DatabaseSummaryRecord): DatabaseSummary => ({
  ...record,
  database: toDatabase(record.database),
})

export const createDatabaseRepository = (dao: DatabaseDao): DatabaseRepository => ({
  findVersion: dao.findVersion,
  findById: async (productId, databaseId) => {
    const record = await dao.findById(productId, databaseId)
    return record ? toDatabase(record) : null
  },
  findScope: async (productId, databaseId, options) => {
    const scope = await dao.findScope(productId, databaseId, options)
    return scope
      ? {
          database: toDatabase(scope.database),
          commonColumns:
            scope.commonColumns === null ? [] : (JSON.parse(scope.commonColumns) as unknown[]),
          versions: scope.versions,
          deployments: scope.deployments ?? [],
        }
      : null
  },
  create: ({ database, ...input }) =>
    dao.create({ ...input, database: { ...database, deletedAt: null } }),
  update: async (input) => {
    const { database, productRevision } = await dao.update(input)
    return { database: toDatabase(database), productRevision }
  },
  saveCommonColumns: ({ commonColumns, ...input }) =>
    dao.saveCommonColumns({ ...input, commonColumns: JSON.stringify(commonColumns) }),
  delete: (input) => dao.delete(input),
})
