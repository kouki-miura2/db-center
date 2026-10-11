import { createLogger, LIMITS } from 'utils'

import type { DeploymentRecord } from '../dao/deployment.interface.ts'
import type { PurgeKind } from '../dao/maintenance.interface.ts'
import {
  type DeploymentStorage,
  deploymentStorageKeys,
  type DeploymentWorkflow,
} from '../repository/deployment-runtime.interface.ts'
import type { DeploymentRepository } from '../repository/deployment.repository.ts'
import type { MaintenanceRepository } from '../repository/maintenance.repository.ts'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** What replaces an expired invitation's email in its audit log entry ("データ保持・プライバシー"). */
export const REDACTED_EMAIL = '削除済みのメールアドレス'

/**
 * How one cleanup task went: rows handled, targets left for a later run (`skipped`) or that failed
 * on their own (`failed`), and the error that stopped the whole task, if any.
 */
export interface TaskReport {
  processed: number
  skipped?: number
  failed?: number
  error?: string
}

export interface MaintenanceService {
  /**
   * The daily scheduled job ("参照 > アーキテクチャ": 定期処理). Each task runs batch after batch of
   * `LIMITS.cleanupBatchSize` until nothing is left; one failing task is logged and doesn't stop
   * the others, and whatever it left is picked up by the next run.
   */
  runDaily: (now: number) => Promise<Record<string, TaskReport>>
}

// A deployment's progress log (JSON object), or nothing.
const parseLog = (log: string | null): Record<string, unknown> => {
  try {
    const value: unknown = log === null ? null : JSON.parse(log)
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  } catch {
    return {}
  }
}

export const createMaintenanceService = (deps: {
  maintenance: MaintenanceRepository
  /** Where deployments keep their SQL; unset when automatic execution isn't configured. */
  storage?: DeploymentStorage
  deployments: DeploymentRepository
  /** Unset when automatic execution isn't configured. */
  workflow?: DeploymentWorkflow
}): MaintenanceService => {
  const logger = createLogger({ format: 'json' })
  const m = deps.maintenance
  const limit = LIMITS.cleanupBatchSize

  const run = async (
    reports: Record<string, TaskReport>,
    task: string,
    work: (report: TaskReport) => Promise<void>,
  ) => {
    const report: TaskReport = { processed: 0 }
    reports[task] = report
    try {
      await work(report)
      logger.info('maintenance task completed', { task, ...report })
    } catch (error) {
      report.error = String(error)
      logger.error('maintenance task failed', { task, ...report })
    }
  }

  // Repeats a batch until it handles fewer rows than the batch size.
  const drain = (batch: (limit: number) => Promise<number>) => async (report: TaskReport) => {
    for (;;) {
      const processed = await batch(limit)
      report.processed += processed
      if (processed < limit) return
    }
  }

  /**
   * Purges products (or databases) deleted at or before `cutoff`, page by page. A deployment's SQL
   * goes from object storage first; if that fails, the rows stay so the next run can retry it.
   * Anything with a deployment still running waits for a later run.
   */
  const purge = (kind: PurgeKind, cutoff: number) => async (report: TaskReport) => {
    report.skipped = 0
    report.failed = 0
    let after: string | null = null
    for (;;) {
      const targets = await m.findPurgeable({ kind, cutoff, after, limit })
      for (const target of targets) {
        after = target.id
        const fields = { kind, id: target.id, deployments: target.deploymentIds.length }
        if (target.running || (target.deploymentIds.length > 0 && !deps.storage)) {
          report.skipped += 1
          logger.warn('purge postponed', {
            ...fields,
            reason: target.running ? 'deployment_running' : 'storage_not_configured',
          })
          continue
        }
        try {
          await deps.storage?.deleteAll(target.deploymentIds.flatMap(deploymentStorageKeys))
          if (await m.purge({ kind, id: target.id, cutoff })) {
            report.processed += 1
            logger.info('purged', fields)
          } else {
            report.skipped += 1
            logger.warn('purge postponed', { ...fields, reason: 'no_longer_purgeable' })
          }
        } catch (error) {
          report.failed += 1
          logger.error('purge failed', { ...fields, error: String(error) })
        }
      }
      if (targets.length < limit) return
    }
  }

  /**
   * Settles a deployment left running. Nothing is run again and nothing is marked succeeded: a
   * deployment whose SQL may have run ends failed with `requiresInspection`, its progress log kept,
   * so the result is checked against the target database (`_dbcenter.version`) by hand.
   */
  const reconcileOne = async (r: DeploymentRecord, now: number) => {
    const fail = async (code: string, requiresInspection: boolean) => {
      const previous = parseLog(r.log)
      const log = JSON.stringify({ ...previous, code, requiresInspection, reconciled: true })
      const done = await deps.deployments.abandon({
        id: r.id,
        phase: r.phase,
        executedCount: r.executedCount,
        log,
        now,
      })
      return done ? `failed:${code}` : 'moved_on'
    }
    // Accepted, but its plan wasn't queued: no Workflow, no SQL.
    if (r.phase === 'preparing') return fail('preparation_failed', false)
    const workflow = deps.workflow ? await deps.workflow.status(r.id) : 'missing'
    if (workflow === 'active') return 'waiting'
    if (r.phase === 'queued') {
      if (!deps.workflow) return fail('workflow_not_configured', false)
      // The start was lost. The deployment isn't claimed yet, so starting it under the same ID
      // runs it exactly once (a second start of an existing ID is refused).
      if (workflow === 'missing') {
        await deps.workflow.start(r.id)
        return 'restarted'
      }
      // The Workflow ended without claiming it: none of its SQL ran.
      return fail('workflow_failed', false)
    }
    // Executing. A Workflow that can't be found may still be within its time limit.
    if (
      workflow === 'missing' &&
      r.startedAt > now - LIMITS.deploymentWorkflowTimeoutMinutes * MINUTE
    )
      return 'waiting'
    return fail('outcome_unknown', true)
  }

  const reconcile = (now: number) => async (report: TaskReport) => {
    report.skipped = 0
    report.failed = 0
    const records = await deps.deployments.listRunning(
      now - LIMITS.deploymentReconcileMinutes * MINUTE,
    )
    for (const r of records) {
      const fields = { deploymentId: r.id, phase: r.phase, executedCount: r.executedCount }
      try {
        const outcome = await reconcileOne(r, now)
        if (outcome === 'waiting' || outcome === 'moved_on') report.skipped += 1
        else report.processed += 1
        logger.info('deployment reconciled', { ...fields, outcome })
      } catch (error) {
        report.failed += 1
        logger.error('deployment reconciliation failed', { ...fields, error: String(error) })
      }
    }
  }

  return {
    runDaily: async (now) => {
      const reports: Record<string, TaskReport> = {}
      await run(
        reports,
        'expiredSessions',
        drain((size) => m.deleteExpiredSessions(now, size)),
      )
      await run(
        reports,
        'expiredInvitations',
        drain((size) => m.deleteExpiredInvitations(now, size)),
      )
      // An invitation expires `invitationHours` after it's made, and its email goes with it.
      await run(
        reports,
        'invitationEmails',
        drain((size) =>
          m.redactInvitationEmails({
            cutoff: now - LIMITS.invitationHours * HOUR,
            replacement: REDACTED_EMAIL,
            limit: size,
          }),
        ),
      )
      await run(
        reports,
        'passcodeFailures',
        drain((size) =>
          m.deletePasscodeFailures(now - LIMITS.passcodeFailureWindowHours * HOUR, size),
        ),
      )
      await run(
        reports,
        'auditLogs',
        drain((size) => m.deleteAuditLogs(now - LIMITS.auditLogRetentionDays * DAY, size)),
      )
      // A product's purge takes its databases with it, so the order doesn't matter.
      const deletedCutoff = now - LIMITS.deletedRetentionDays * DAY
      await run(reports, 'purgedDatabases', purge('database', deletedCutoff))
      await run(reports, 'purgedProducts', purge('product', deletedCutoff))
      await run(reports, 'reconciledDeployments', reconcile(now))
      return reports
    },
  }
}
