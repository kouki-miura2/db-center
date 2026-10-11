import { utf8ByteLength } from 'utils'

import { AppError } from '../error.ts'
import { databases, objects, versions } from './database.memory.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ObjectDao, VersionContext } from './object.interface.ts'
import type { ProductRecord } from './product.interface.ts'
import { assertActorRole, bumpProductRevision } from './product.memory.ts'
import { nextUpdatedAt } from './write.ts'

export const memoryVersionContext = (db: MemoryDb, versionId: string): VersionContext | null => {
  const version = versions(db).get(versionId)
  const database = version && databases(db).get(version.databaseId)
  const product = database && memoryTable<ProductRecord>(db, 'products').get(database.productId)
  return version && database?.deletedAt === null && product?.deletedAt === null
    ? structuredClone({
        version,
        productId: product.id,
        databaseName: database.name,
        target: product.target,
      })
    : null
}
export const createObjectMemoryDao = (db: MemoryDb): ObjectDao => ({
  findContext: async (id) => memoryVersionContext(db, id),
  findScope: async (id, since) => {
    const context = memoryVersionContext(db, id)
    if (!context) return null
    const delta =
      since !== undefined &&
      since >= context.version.compactedRevision &&
      since <= context.version.revision
    return {
      context,
      objects: structuredClone(
        [...objects(db).values()].filter(
          (v) => v.versionId === id && (delta ? v.revision > since : v.deletedAt === null),
        ),
      ),
    }
  },
  save: async (input) =>
    atomic(db, () => {
      const context = memoryVersionContext(db, input.context.version.id)
      if (
        !context ||
        context.productId !== input.context.productId ||
        context.version.status !== 'editing'
      )
        throw new AppError('stale_update')
      assertActorRole(db, context.productId, input.userId, input.allowedRoles)
      const own = [...objects(db).values()].filter((v) => v.versionId === context.version.id)
      const current = own.find((v) => v.objectKey === input.record.objectKey)
      if (input.expectedUpdatedAt !== null) {
        if (!current || current.deletedAt !== null) throw new AppError('stale_update')
        assertCurrent(current, input.expectedUpdatedAt)
        if (current.kind !== input.record.kind) throw new AppError('stale_update')
      } else if (current) throw new AppError('duplicate')
      if (
        !input.delete &&
        own.some(
          (v) =>
            v.deletedAt === null &&
            v.objectKey !== input.record.objectKey &&
            v.schemaKey === input.record.schemaKey &&
            v.name === input.record.name,
        )
      )
        throw new AppError('duplicate')
      if (
        !input.delete &&
        input.record.schemaKey &&
        !own.some(
          (v) =>
            v.objectKey === input.record.schemaKey && v.kind === 'schema' && v.deletedAt === null,
        )
      )
        throw new AppError('stale_update')
      if (
        input.delete &&
        input.record.kind === 'schema' &&
        own.some((v) => v.schemaKey === input.record.objectKey && v.deletedAt === null)
      )
        throw new AppError('invalid_state')
      const version = versions(db).get(context.version.id)!
      version.revision += 1
      const record = {
        ...input.record,
        id: current?.id ?? input.record.id,
        updatedAt: nextUpdatedAt(input.now, current?.updatedAt ?? input.now - 1),
        revision: version.revision,
        deletedAt: input.delete ? input.now : null,
      }
      objects(db).set(record.id, record)
      const active = [...objects(db).values()].filter(
        (v) => v.versionId === version.id && v.deletedAt === null,
      )
      version.schemaCount = active.filter((v) => v.kind === 'schema').length
      version.tableCount = active.filter((v) => v.kind === 'table').length
      version.definitionBytes = active.reduce((sum, v) => sum + utf8ByteLength(v.definition), 0)
      if (active.length > input.maxObjects || version.definitionBytes > input.maxBytes)
        throw new AppError('limit_exceeded')
      version.updatedAt = nextUpdatedAt(input.now, version.updatedAt)
      const database = databases(db).get(version.databaseId)!
      database.updatedAt = nextUpdatedAt(input.now, database.updatedAt)
      database.revision += 1
      const product = bumpProductRevision(db, context.productId)
      appendAuditLog(db, input.audit)
      return {
        object: structuredClone(record),
        revisions: { version: version.revision, database: database.revision, product },
      }
    }),
})
