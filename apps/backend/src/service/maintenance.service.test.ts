import { LIMITS } from 'utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import type { MaintenanceRepository } from '../repository/maintenance.repository.ts'
import { createMaintenanceService, REDACTED_EMAIL } from './maintenance.service.ts'

const HOUR = 60 * 60 * 1000
const now = 1_000 * 24 * HOUR
const batch = LIMITS.cleanupBatchSize

// Answers each call with the next count, then 0.
const counts = (...values: number[]) => {
  const queue = [...values]
  return vi.fn(async () => queue.shift() ?? 0)
}

const fakeMaintenance = (
  overrides: Partial<MaintenanceRepository> = {},
): MaintenanceRepository => ({
  deleteExpiredSessions: counts(),
  deleteExpiredInvitations: counts(),
  deletePasscodeFailures: counts(),
  redactInvitationEmails: counts(),
  deleteAuditLogs: counts(),
  ...overrides,
})

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('repeats a task batch after batch until fewer rows than a batch are left', async () => {
  const deleteExpiredSessions = counts(batch, batch, 3)
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({ deleteExpiredSessions }),
  })

  const report = await service.runDaily(now)

  expect(deleteExpiredSessions).toHaveBeenCalledTimes(3)
  expect(deleteExpiredSessions).toHaveBeenCalledWith(now, batch)
  expect(report.expiredSessions).toEqual({ processed: batch * 2 + 3 })
})

test('uses each retention period as the cutoff', async () => {
  const m = fakeMaintenance()

  await createMaintenanceService({ maintenance: m }).runDaily(now)

  expect(m.deleteExpiredInvitations).toHaveBeenCalledWith(now, batch)
  expect(m.redactInvitationEmails).toHaveBeenCalledWith({
    cutoff: now - LIMITS.invitationHours * HOUR,
    replacement: REDACTED_EMAIL,
    limit: batch,
  })
  expect(m.deletePasscodeFailures).toHaveBeenCalledWith(
    now - LIMITS.passcodeFailureWindowHours * HOUR,
    batch,
  )
  expect(m.deleteAuditLogs).toHaveBeenCalledWith(
    now - LIMITS.auditLogRetentionDays * 24 * HOUR,
    batch,
  )
})

test('a failing task is logged and reported, and the others still run', async () => {
  const deleteAuditLogs = counts(4)
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({
      deleteExpiredInvitations: vi
        .fn()
        .mockResolvedValueOnce(batch)
        .mockRejectedValueOnce(new Error('D1 unavailable')),
      deleteAuditLogs,
    }),
  })

  const report = await service.runDaily(now)

  expect(report.expiredInvitations).toEqual({
    processed: batch,
    error: 'Error: D1 unavailable',
  })
  expect(report.auditLogs).toEqual({ processed: 4 })
  const logged = vi.mocked(console.error).mock.calls.map(([line]) => JSON.parse(String(line)))
  expect(logged).toEqual([
    expect.objectContaining({
      message: 'maintenance task failed',
      task: 'expiredInvitations',
      processed: batch,
    }),
  ])
})
