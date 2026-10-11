import { AppError } from '../error.ts'
import { databases, versions } from './database.memory.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import { memoryVersionContext } from './object.memory.ts'
import { assertActorRole, bumpProductRevision } from './product.memory.ts'
import type { ApplicationRecord, VersionDao } from './version.interface.ts'
import { nextUpdatedAt } from './write.ts'
type DeploymentRow = ApplicationRecord & { toVersionId: string }
export const memoryApplications = (db: MemoryDb, id: string) =>
  [...memoryTable<DeploymentRow>(db, 'deployments').values()]
    .filter((v) => v.toVersionId === id)
    .map(({ id, connectionName, status }) => ({ id, connectionName, status }))
export const createVersionMemoryDao = (db: MemoryDb): VersionDao => ({
  applications: async (id) => memoryApplications(db, id),
  transition: async (input) =>
    atomic(db, () => {
      const context = memoryVersionContext(db, input.context.version.id)
      if (!context || context.productId !== input.context.productId)
        throw new AppError('stale_update')
      assertActorRole(db, context.productId, input.userId, input.allowedRoles)
      const row = assertCurrent(versions(db).get(context.version.id), input.expectedUpdatedAt)
      if (
        row.revision !== input.expectedRevision ||
        row.status !== (input.to === 'provisional' ? 'editing' : 'provisional')
      )
        throw new AppError('stale_update')
      const applied = memoryApplications(db, row.id)
      if (
        applied.some((v) => v.status === 'running') ||
        (input.to === 'editing' &&
          !input.acknowledgeApplied &&
          applied.some((v) => v.status === 'succeeded'))
      )
        throw new AppError('invalid_state')
      row.status = input.to
      row.memo = input.memo
      row.provisionalAt = input.to === 'provisional' ? input.now : null
      row.updatedAt = nextUpdatedAt(input.now, row.updatedAt)
      row.revision += 1
      const database = databases(db).get(row.databaseId)!
      database.updatedAt = nextUpdatedAt(input.now, database.updatedAt)
      database.revision += 1
      const product = bumpProductRevision(db, context.productId)
      appendAuditLog(db, input.audit)
      return {
        version: structuredClone(row),
        revisions: { version: row.revision, database: database.revision, product },
      }
    }),
})
