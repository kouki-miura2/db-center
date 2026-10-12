import { AppError } from '../error.ts'
import type { ConnectionRecord } from './connection.interface.ts'
import type { DatabaseRecord, VersionRecord } from './database.interface.ts'
import type {
  DeploymentDao,
  DeploymentReadRecord,
  DeploymentRecord,
} from './deployment.interface.ts'
import { atomic, memoryTable, appendAuditLog, type MemoryDb } from './memory-db.ts'
import { memoryVersionContext } from './object.memory.ts'
import type { UserRecord } from './user.interface.ts'

const withExecutor = (db: MemoryDb, record: DeploymentRecord): DeploymentReadRecord => ({
  ...record,
  executedByName:
    memoryTable<UserRecord>(db, 'users').get(record.executedBy)?.name ?? '不明なユーザー',
})
import {
  assertActorRole,
  bumpProductRevision,
  memberKey,
  type MemberRow,
} from './product.memory.ts'

export const memoryDeployments = (db: MemoryDb, databaseId: string) =>
  [...memoryTable<DeploymentRecord>(db, 'deployments').values()]
    .filter((v) => v.databaseId === databaseId)
    .toSorted((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
    .map((v) => withExecutor(db, v))
export const createDeploymentMemoryDao = (db: MemoryDb): DeploymentDao => {
  const rows = () => memoryTable<DeploymentRecord>(db, 'deployments')
  const close = closeDeployment(db)
  const transition = async (
    id: string,
    from: DeploymentRecord['phase'],
    to: DeploymentRecord['phase'],
  ) =>
    atomic(db, () => {
      const r = rows().get(id)
      if (!r || r.status !== 'running' || r.phase !== from) return false
      r.phase = to
      return true
    })
  return {
    findById: async (id) => {
      const r = rows().get(id)
      return r ? withExecutor(db, r) : null
    },
    findByKey: async (id, key) => {
      const r = [...rows().values()].find((v) => v.connectionId === id && v.idempotencyKey === key)
      return r ? withExecutor(db, r) : null
    },
    listByVersion: async (versionId) =>
      [...rows().values()]
        .filter((r) => r.toVersionId === versionId)
        .toSorted((a, b) => b.startedAt - a.startedAt || b.id.localeCompare(a.id))
        .map((r) => withExecutor(db, r)),
    findForMember: async (id, userId) => {
      const r = rows().get(id)
      const context = r ? memoryVersionContext(db, r.toVersionId) : null
      const member = r
        ? memoryTable<MemberRow>(db, 'product_members').get(memberKey(r.productId, userId))
        : undefined
      return r && context && context.productId === r.productId && member
        ? { record: withExecutor(db, r), role: member.role }
        : null
    },
    accept: async ({ record: r, userId, allowedRoles, connectionUpdatedAt, audit }) =>
      atomic(db, () => {
        assertActorRole(db, r.productId, userId, allowedRoles)
        const conn = memoryTable<ConnectionRecord>(db, 'connections').get(r.connectionId!)
        const database = memoryTable<DatabaseRecord>(db, 'databases').get(r.databaseId)
        const versions = memoryTable<VersionRecord>(db, 'versions'),
          target = versions.get(r.toVersionId),
          source = r.fromVersionId ? versions.get(r.fromVersionId) : null
        if (
          !conn ||
          conn.productId !== r.productId ||
          conn.updatedAt !== connectionUpdatedAt ||
          !database ||
          database.productId !== r.productId ||
          database.deletedAt !== null ||
          !target ||
          target.databaseId !== r.databaseId ||
          target.status === 'editing' ||
          target.revision !== r.targetRevision ||
          (r.fromVersionId &&
            (!source ||
              source.databaseId !== r.databaseId ||
              source.status === 'editing' ||
              source.revision !== r.sourceRevision))
        )
          throw new AppError('stale_update')
        if (
          [...rows().values()].some(
            (v) =>
              v.connectionId === r.connectionId &&
              (v.status === 'running' || v.idempotencyKey === r.idempotencyKey),
          )
        )
          throw new AppError('duplicate')
        database.revision++
        rows().set(r.id, { ...r, revision: database.revision })
        bumpProductRevision(db, r.productId)
        appendAuditLog(db, audit)
      }),
    queue: (id) => transition(id, 'preparing', 'queued'),
    claim: (id) => transition(id, 'queued', 'executing'),
    progress: async (id, count, log) =>
      atomic(db, () => {
        const r = rows().get(id)
        if (r?.status === 'running' && r.phase === 'executing' && count >= r.executedCount) {
          r.executedCount = count
          r.log = log
        }
      }),
    finish: async (id, status, log, now) =>
      atomic(db, () => {
        const r = rows().get(id)
        if (!r || r.status !== 'running') return
        close(r, status, log, now)
      }),
    listRunning: async (startedBefore) =>
      [...rows().values()]
        .filter((r) => r.status === 'running' && r.startedAt <= startedBefore)
        .toSorted((a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id))
        .map((r) => withExecutor(db, r)),
    abandon: async ({ id, phase, executedCount, log, now }) =>
      atomic(db, () => {
        const r = rows().get(id)
        if (!r || r.status !== 'running' || r.phase !== phase || r.executedCount !== executedCount)
          return false
        close(r, 'failed', log, now)
        return true
      }),
  }
}

// A running deployment's end: its status, the database and product revisions, the audit log.
const closeDeployment =
  (db: MemoryDb) =>
  (r: DeploymentRecord, status: 'succeeded' | 'failed', log: string, now: number) => {
    r.status = status
    r.phase = 'finished'
    r.log = log
    r.finishedAt = now
    const database = memoryTable<DatabaseRecord>(db, 'databases').get(r.databaseId)
    if (database) {
      database.revision++
      r.revision = database.revision
    }
    bumpProductRevision(db, r.productId)
    appendAuditLog(db, {
      id: crypto.randomUUID(),
      productId: r.productId,
      userId: r.executedBy,
      targetType: 'deployment',
      action: status,
      summary: r.connectionName,
      createdAt: now,
    })
  }
