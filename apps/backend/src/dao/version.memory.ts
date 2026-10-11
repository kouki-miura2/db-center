import { AppError } from '../error.ts'
import type { VersionRecord } from './database.interface.ts'
import { copyMemoryObjects, databases, objects, versions } from './database.memory.ts'
import { appendAuditLog, assertCurrent, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import { memoryVersionContext } from './object.memory.ts'
import { assertActorRole, bumpProductRevision } from './product.memory.ts'
import type { ApplicationRecord, VersionDao, VersionWrite } from './version.interface.ts'
import { nextUpdatedAt } from './write.ts'
type DeploymentRow = ApplicationRecord & { toVersionId: string }
export const memoryApplications = (db: MemoryDb, id: string) =>
  [...memoryTable<DeploymentRow>(db, 'deployments').values()]
    .filter(
      (v) =>
        v.toVersionId === id ||
        ((v as DeploymentRow & { fromVersionId?: string }).fromVersionId === id &&
          v.status === 'running'),
    )
    .map(({ id, connectionName, status }) => ({ id, connectionName, status }))
const current = (db: MemoryDb, input: VersionWrite) => {
  const c = memoryVersionContext(db, input.context.version.id)
  if (!c || c.productId !== input.context.productId) throw new AppError('stale_update')
  assertActorRole(db, c.productId, input.userId, input.allowedRoles)
  const row = assertCurrent(versions(db).get(c.version.id), input.expectedUpdatedAt)
  if (row.revision !== input.expectedRevision) throw new AppError('stale_update')
  return row
}
const cloneVersion = (
  db: MemoryDb,
  source: VersionRecord,
  id: string,
  userId: string,
  now: number,
) => {
  if (versions(db).has(id)) throw new AppError('duplicate')
  const own = [...versions(db).values()].filter((v) => v.databaseId === source.databaseId)
  if (source.status !== 'final' || own.some((v) => v.status !== 'final'))
    throw new AppError('stale_update')
  const row: VersionRecord = {
    ...source,
    id,
    number: Math.max(...own.map((v) => v.number)) + 1,
    status: 'editing',
    sourceVersionId: source.id,
    memo: null,
    provisionalAt: null,
    finalizedAt: null,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    compactedRevision: 1,
  }
  versions(db).set(id, row)
  copyMemoryObjects(db, source.id, id, userId, now)
  return row
}
const bumpParents = (db: MemoryDb, input: VersionWrite, version: VersionRecord) => {
  const database = databases(db).get(version.databaseId)!
  database.updatedAt = nextUpdatedAt(input.now, database.updatedAt)
  database.revision++
  return {
    version: version.revision,
    database: database.revision,
    product: bumpProductRevision(db, input.context.productId),
  }
}
export const createVersionMemoryDao = (db: MemoryDb): VersionDao => ({
  finalize: async (input) =>
    atomic(db, () => {
      const row = current(db, input)
      if (row.status !== 'provisional') throw new AppError('stale_update')
      row.status = 'final'
      row.memo = input.memo
      row.finalizedAt = input.now
      row.updatedAt = nextUpdatedAt(input.now, row.updatedAt)
      row.revision++
      row.compactedRevision = row.revision
      objects(db).forEach((v) => {
        if (v.versionId === row.id && v.deletedAt !== null) objects(db).delete(v.id)
      })
      const next = input.next ? cloneVersion(db, row, input.next.id, input.userId, input.now) : null
      appendAuditLog(db, input.audit)
      if (input.next) appendAuditLog(db, input.next.audit)
      return {
        version: structuredClone(row),
        createdVersion: next ? structuredClone(next) : null,
        revisions: bumpParents(db, input, row),
      }
    }),
  create: async (input) =>
    atomic(db, () => {
      const source = current(db, input)
      const row = cloneVersion(db, source, input.clone.id, input.userId, input.now)
      appendAuditLog(db, input.clone.audit)
      return { version: structuredClone(row), revisions: bumpParents(db, input, row) }
    }),
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
