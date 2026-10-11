import { LIMITS } from 'utils'
import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import type { PurgeTarget } from '../dao/maintenance.interface.ts'
import type { DeploymentStorage } from '../repository/deployment-runtime.interface.ts'
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
  findPurgeable: vi.fn(async () => []),
  purge: vi.fn(async () => true),
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

const DAY = 24 * HOUR
const deletedCutoff = now - LIMITS.deletedRetentionDays * DAY

// Deleted databases (none of them products) to purge, in one page.
const purgeable = (...targets: PurgeTarget[]) =>
  vi.fn<MaintenanceRepository['findPurgeable']>(async ({ kind, after }) =>
    kind === 'database' && after === null ? targets : [],
  )

const storage = (overrides: Partial<DeploymentStorage> = {}): DeploymentStorage => ({
  putOnce: async () => {},
  get: async () => null,
  deleteAll: vi.fn(async () => {}),
  ...overrides,
})

test('purges deleted databases and products past retention, their SQL first', async () => {
  const order: string[] = []
  const purge = vi.fn<MaintenanceRepository['purge']>(async ({ id }) => {
    order.push(`purge ${id}`)
    return true
  })
  const deleteAll = vi.fn<DeploymentStorage['deleteAll']>(async (keys) => {
    order.push(`delete ${keys.join(' ')}`)
  })
  const findPurgeable = purgeable(
    { id: 'd1', deploymentIds: ['x1'], running: false },
    { id: 'd2', deploymentIds: [], running: false },
  )
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({ findPurgeable, purge }),
    storage: storage({ deleteAll }),
  })

  const report = await service.runDaily(now)

  expect(order).toEqual([
    'delete deployments/x1.sql deployments/x1.json',
    'purge d1',
    'delete ',
    'purge d2',
  ])
  expect(purge).toHaveBeenCalledWith({ kind: 'database', id: 'd1', cutoff: deletedCutoff })
  expect(findPurgeable).toHaveBeenCalledWith({
    kind: 'product',
    cutoff: deletedCutoff,
    after: null,
    limit: batch,
  })
  expect(report.purgedDatabases).toEqual({ processed: 2, skipped: 0, failed: 0 })
  expect(report.purgedProducts).toEqual({ processed: 0, skipped: 0, failed: 0 })
})

test('pages through purge targets after the last one seen', async () => {
  const page = Array.from({ length: batch }, (_, i) => ({
    id: `d${String(i).padStart(4, '0')}`,
    deploymentIds: [],
    running: false,
  }))
  const findPurgeable = vi.fn<MaintenanceRepository['findPurgeable']>(async ({ kind, after }) =>
    kind !== 'database' ? [] : after === null ? page : [],
  )

  await createMaintenanceService({
    maintenance: fakeMaintenance({ findPurgeable }),
  }).runDaily(now)

  expect(findPurgeable).toHaveBeenCalledWith(
    expect.objectContaining({ kind: 'database', after: page.at(-1)?.id }),
  )
})

test('leaves a target whose SQL can’t be deleted, or that is still running, for a later run', async () => {
  const purge = vi.fn(async () => true)
  const deleteAll = vi.fn<DeploymentStorage['deleteAll']>(async (keys) => {
    if (keys.includes('deployments/x1.sql')) throw new Error('R2 unavailable')
  })
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({
      findPurgeable: purgeable(
        { id: 'd1', deploymentIds: ['x1'], running: false },
        { id: 'd2', deploymentIds: ['x2'], running: true },
        { id: 'd3', deploymentIds: ['x3'], running: false },
      ),
      purge,
    }),
    storage: storage({ deleteAll }),
  })

  const report = await service.runDaily(now)

  expect(report.purgedDatabases).toEqual({ processed: 1, skipped: 1, failed: 1 })
  expect(purge).toHaveBeenCalledTimes(1)
  expect(purge).toHaveBeenCalledWith({ kind: 'database', id: 'd3', cutoff: deletedCutoff })
  // The running deployment's SQL is left alone.
  expect(deleteAll).not.toHaveBeenCalledWith(expect.arrayContaining(['deployments/x2.sql']))
})

test('without storage, only targets without deployments are purged', async () => {
  const purge = vi.fn(async () => true)
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({
      findPurgeable: purgeable(
        { id: 'd1', deploymentIds: ['x1'], running: false },
        { id: 'd2', deploymentIds: [], running: false },
      ),
      purge,
    }),
  })

  const report = await service.runDaily(now)

  expect(report.purgedDatabases).toEqual({ processed: 1, skipped: 1, failed: 0 })
  expect(purge).toHaveBeenCalledWith({ kind: 'database', id: 'd2', cutoff: deletedCutoff })
})

test('a target that no longer qualifies when purged counts as skipped', async () => {
  const service = createMaintenanceService({
    maintenance: fakeMaintenance({
      findPurgeable: purgeable({ id: 'd1', deploymentIds: [], running: false }),
      purge: vi.fn(async () => false),
    }),
  })

  expect((await service.runDaily(now)).purgedDatabases).toEqual({
    processed: 0,
    skipped: 1,
    failed: 0,
  })
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
