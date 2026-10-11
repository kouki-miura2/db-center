import { utf8ByteLength } from 'utils'

import { AppError } from '../error.ts'
import type {
  DatabaseDao,
  DatabaseRecord,
  DatabaseSummaryRecord,
  VersionRecord,
} from './database.interface.ts'
import { memoryDeployments } from './deployment.memory.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ObjectRecord } from './object.interface.ts'
import { assertActorRole, bumpProductRevision } from './product.memory.ts'
import { nextUpdatedAt } from './write.ts'

/** One `databases` row: the record plus its common column set. */
export type DatabaseRow = DatabaseRecord & { commonColumns: string | null }

/** One `objects` row. */
export type ObjectRow = ObjectRecord

export const databases = (db: MemoryDb) => memoryTable<DatabaseRow>(db, 'databases')
export const versions = (db: MemoryDb) => memoryTable<VersionRecord>(db, 'versions')
export const objects = (db: MemoryDb) => memoryTable<ObjectRow>(db, 'objects')

const activeOf = (db: MemoryDb, productId: string) =>
  [...databases(db).values()].filter((row) => row.productId === productId && row.deletedAt === null)

const toRecord = (row: DatabaseRow): DatabaseRecord => ({
  id: row.id,
  productId: row.productId,
  name: row.name,
  description: row.description,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  revision: row.revision,
  deletedAt: row.deletedAt,
})

const inProduct = (db: MemoryDb, productId: string, databaseId: string) => {
  const row = databases(db).get(databaseId)
  return row?.productId === productId && row.deletedAt === null ? row : undefined
}

const assertNameFree = (db: MemoryDb, productId: string, name: string, exceptId: string) => {
  if (activeOf(db, productId).some((row) => row.name === name && row.id !== exceptId)) {
    throw new AppError('duplicate')
  }
}

/** The product scope's database list (deleted databases aside), as `ProductDao.findScope` reads it. */
export const databaseSummaries = (db: MemoryDb, productId: string): DatabaseSummaryRecord[] =>
  activeOf(db, productId).flatMap((database) => {
    const own = [...versions(db).values()]
      .filter((row) => row.databaseId === database.id)
      .toSorted((a, b) => b.number - a.number)
    const latest = own[0]
    if (!latest) return []
    const final = own.find((row) => row.status === 'final')
    return {
      database: toRecord(database),
      latestVersion: {
        id: latest.id,
        number: latest.number,
        status: latest.status,
        schemaCount: latest.schemaCount,
        tableCount: latest.tableCount,
      },
      latestFinalVersion: final ? { id: final.id, number: final.number } : null,
    }
  })

/** In-memory `DatabaseDao` over the shared `MemoryDb`. */
export const createDatabaseMemoryDao = (db: MemoryDb): DatabaseDao => ({
  findVersion: async (productId, versionId) => {
    const version = versions(db).get(versionId)
    const product = memoryTable<{ deletedAt: number | null }>(db, 'products').get(productId)
    return product?.deletedAt === null && version && inProduct(db, productId, version.databaseId)
      ? structuredClone(version)
      : null
  },
  findById: async (productId, databaseId) => {
    const product = memoryTable<{ deletedAt: number | null }>(db, 'products').get(productId)
    const row = inProduct(db, productId, databaseId)
    return product && product.deletedAt === null && row ? toRecord(row) : null
  },

  findScope: async (productId, databaseId, options = {}) => {
    const product = memoryTable<{ deletedAt: number | null }>(db, 'products').get(productId)
    const row = inProduct(db, productId, databaseId)
    if (!product || product.deletedAt !== null || !row) return null
    const since = options.deployments?.since
    const delta = since !== undefined && since <= row.revision
    return {
      database: toRecord(row),
      commonColumns: row.commonColumns,
      ...(options.deployments
        ? {
            deployments: memoryDeployments(db, databaseId).filter(
              (deployment) => !delta || deployment.revision > since,
            ),
          }
        : {}),
      versions: [...versions(db).values()]
        .filter((version) => version.databaseId === databaseId)
        .map((version) => ({ ...version })),
    }
  },

  create: async ({
    database,
    versionId,
    schema,
    maxDatabases,
    userId,
    allowedRoles,
    audit,
    sourceVersionId,
  }) =>
    atomic(db, () => {
      assertActorRole(db, database.productId, userId, allowedRoles)
      const source = sourceVersionId ? versions(db).get(sourceVersionId) : null
      if (
        sourceVersionId &&
        (!source ||
          source.status !== 'final' ||
          !inProduct(db, database.productId, source.databaseId))
      )
        throw new AppError('stale_update')
      assertNameFree(db, database.productId, database.name, database.id)
      databases(db).set(database.id, { ...database, commonColumns: null })
      if (activeOf(db, database.productId).length > maxDatabases) {
        throw new AppError('limit_exceeded')
      }
      versions(db).set(versionId, {
        id: versionId,
        databaseId: database.id,
        number: 1,
        status: 'editing',
        sourceVersionId: null,
        memo: null,
        provisionalAt: null,
        finalizedAt: null,
        createdAt: database.createdAt,
        updatedAt: database.createdAt,
        revision: 1,
        compactedRevision: 1,
        schemaCount: source?.schemaCount ?? (schema ? 1 : 0),
        tableCount: source?.tableCount ?? 0,
        definitionBytes:
          source?.definitionBytes ?? (schema ? utf8ByteLength(schema.definition) : 0),
      })
      if (source) copyMemoryObjects(db, source.id, versionId, userId, database.createdAt)
      if (schema && !source) {
        objects(db).set(schema.id, {
          id: schema.id,
          versionId,
          objectKey: schema.objectKey,
          kind: 'schema',
          schemaKey: null,
          name: schema.name,
          logicalName: null,
          definition: schema.definition,
          updatedBy: userId,
          updatedAt: database.createdAt,
          revision: 1,
          deletedAt: null,
        })
      }
      const productRevision = bumpProductRevision(db, database.productId)
      appendAuditLog(db, audit)
      return { productRevision }
    }),

  update: async (input) =>
    atomic(db, () => {
      assertActorRole(db, input.productId, input.userId, input.allowedRoles)
      const row = assertCurrent(
        inProduct(db, input.productId, input.databaseId),
        input.expectedUpdatedAt,
      )
      assertNameFree(db, input.productId, input.name, row.id)
      row.name = input.name
      row.description = input.description
      row.updatedAt = nextUpdatedAt(input.now, row.updatedAt)
      row.revision += 1
      const productRevision = bumpProductRevision(db, input.productId)
      appendAuditLog(db, input.audit)
      return { database: toRecord(row), productRevision }
    }),

  saveCommonColumns: async (input) =>
    atomic(db, () => {
      assertActorRole(db, input.productId, input.userId, input.allowedRoles)
      const row = inProduct(db, input.productId, input.databaseId)
      if (!row || row.revision !== input.expectedRevision) throw new AppError('stale_update')
      row.commonColumns = input.commonColumns
      row.revision += 1
      return { revision: row.revision }
    }),

  delete: async ({ productId, databaseId, expectedUpdatedAt, now, userId, allowedRoles, audit }) =>
    atomic(db, () => {
      assertActorRole(db, productId, userId, allowedRoles)
      const row = assertCurrent(inProduct(db, productId, databaseId), expectedUpdatedAt)
      if (memoryDeployments(db, databaseId).some((v) => v.status === 'running'))
        throw new AppError('invalid_state')
      row.deletedAt = now
      row.updatedAt = nextUpdatedAt(now, row.updatedAt)
      row.revision += 1
      const productRevision = bumpProductRevision(db, productId)
      appendAuditLog(db, audit)
      return { productRevision }
    }),
})

export const copyMemoryObjects = (
  db: MemoryDb,
  sourceId: string,
  versionId: string,
  userId: string,
  now: number,
) => {
  const rows = [...objects(db).values()].filter(
    (v) => v.versionId === sourceId && v.deletedAt === null,
  )
  rows.forEach((v) => {
    const id = crypto.randomUUID()
    objects(db).set(id, {
      ...structuredClone(v),
      id,
      versionId,
      updatedBy: userId,
      updatedAt: now,
      revision: 1,
    })
  })
}
