import { createLogger, LIMITS } from 'utils'

import type { MaintenanceRepository } from '../repository/maintenance.repository.ts'

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

/** What replaces an expired invitation's email in its audit log entry ("データ保持・プライバシー"). */
export const REDACTED_EMAIL = '削除済みのメールアドレス'

/** How one cleanup task went: rows handled, and the error that stopped it, if any. */
export interface TaskReport {
  processed: number
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
}): MaintenanceService => {
  const logger = createLogger({ format: 'json' })

  // Repeats a batch until it handles fewer rows than the batch size.
  const drain = async (batch: (limit: number) => Promise<number>, report: TaskReport) => {
    const limit = LIMITS.cleanupBatchSize
    for (;;) {
      const processed = await batch(limit)
      report.processed += processed
      if (processed < limit) return
    }
  }

  const run = async (
    reports: Record<string, TaskReport>,
    task: string,
    batch: (limit: number) => Promise<number>,
  ) => {
    const report: TaskReport = { processed: 0 }
    reports[task] = report
    try {
      await drain(batch, report)
      logger.info('maintenance task completed', { task, processed: report.processed })
    } catch (error) {
      report.error = String(error)
      logger.error('maintenance task failed', {
        task,
        processed: report.processed,
        error: report.error,
      })
    }
  }

  return {
    runDaily: async (now) => {
      const m = deps.maintenance
      const reports: Record<string, TaskReport> = {}
      await run(reports, 'expiredSessions', (limit) => m.deleteExpiredSessions(now, limit))
      await run(reports, 'expiredInvitations', (limit) => m.deleteExpiredInvitations(now, limit))
      // An invitation expires `invitationHours` after it's made, and its email goes with it.
      await run(reports, 'invitationEmails', (limit) =>
        m.redactInvitationEmails({
          cutoff: now - LIMITS.invitationHours * HOUR,
          replacement: REDACTED_EMAIL,
          limit,
        }),
      )
      await run(reports, 'passcodeFailures', (limit) =>
        m.deletePasscodeFailures(now - LIMITS.passcodeFailureWindowHours * HOUR, limit),
      )
      await run(reports, 'auditLogs', (limit) =>
        m.deleteAuditLogs(now - LIMITS.auditLogRetentionDays * DAY, limit),
      )
      return reports
    },
  }
}
