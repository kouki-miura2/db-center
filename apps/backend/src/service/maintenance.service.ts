import { createLogger, LIMITS } from 'utils'

import type { PurgeKind } from '../dao/maintenance.interface.ts'
import {
  type DeploymentStorage,
  deploymentStorageKeys,
} from '../repository/deployment-runtime.interface.ts'
import type { MaintenanceRepository } from '../repository/maintenance.repository.ts'

const HOUR = 60 * 60 * 1000
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

export const createMaintenanceService = (deps: {
  maintenance: MaintenanceRepository
  /** Where deployments keep their SQL; unset when automatic execution isn't configured. */
  storage?: DeploymentStorage
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
      return reports
    },
  }
}
