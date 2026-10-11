import type { AuditLogRecord } from './audit-log.interface.ts'
import type { Role } from './product.interface.ts'

export interface DeploymentRecord {
  id: string
  productId: string
  databaseId: string
  connectionId: string | null
  connectionName: string
  kind: 'build' | 'migration'
  fromVersionId: string | null
  toVersionId: string
  status: 'running' | 'succeeded' | 'failed'
  phase: 'preparing' | 'queued' | 'executing' | 'finished'
  executedBy: string
  startedAt: number
  finishedAt: number | null
  log: string | null
  idempotencyKey: string
  requestHash: string
  planHash: string
  connectionSnapshot: string
  targetRevision: number
  sourceRevision: number | null
  executedCount: number
}
export interface DeploymentDao {
  findById: (id: string) => Promise<DeploymentRecord | null>
  findByKey: (connectionId: string, key: string) => Promise<DeploymentRecord | null>
  list: (databaseId: string) => Promise<DeploymentRecord[]>
  accept: (input: {
    record: DeploymentRecord
    userId: string
    allowedRoles: Role[]
    connectionUpdatedAt: number
    audit: AuditLogRecord
  }) => Promise<void>
  queue: (id: string) => Promise<boolean>
  claim: (id: string) => Promise<boolean>
  progress: (id: string, count: number, log: string) => Promise<void>
  finish: (id: string, status: 'succeeded' | 'failed', log: string, now: number) => Promise<void>
  /** Deployments still running that were accepted at or before `startedBefore`, oldest first. */
  listRunning: (startedBefore: number) => Promise<DeploymentRecord[]>
  /**
   * Marks a running deployment failed (like `finish`: revisions and audit log too), but only while
   * it's still in `phase` with `executedCount` steps done, so an executor that moved on since it
   * was read wins. Returns whether it was marked.
   */
  abandon: (input: {
    id: string
    phase: DeploymentRecord['phase']
    executedCount: number
    log: string
    now: number
  }) => Promise<boolean>
}
