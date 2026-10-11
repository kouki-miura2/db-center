import { LIMITS } from 'utils'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vite-plus/test'

import { deploymentRecord } from '../dao/deployment.contract.ts'
import type { DeploymentRecord } from '../dao/deployment.interface.ts'
import type { PurgeTarget } from '../dao/maintenance.interface.ts'
import type {
  DeploymentStorage,
  DeploymentWorkflow,
} from '../repository/deployment-runtime.interface.ts'
import type { DeploymentRepository } from '../repository/deployment.repository.ts'
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

// Only what the scheduled job uses of the deployments.
const fakeDeployments = (
  overrides: Partial<Pick<DeploymentRepository, 'listRunning' | 'abandon'>> = {},
) =>
  ({
    listRunning: vi.fn(async () => []),
    abandon: vi.fn(async () => true),
    ...overrides,
  }) as unknown as DeploymentRepository

const maintenanceService = (deps: Partial<Parameters<typeof createMaintenanceService>[0]>) =>
  createMaintenanceService({
    maintenance: fakeMaintenance(),
    deployments: fakeDeployments(),
    ...deps,
  })

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

test('repeats a task batch after batch until fewer rows than a batch are left', async () => {
  const deleteExpiredSessions = counts(batch, batch, 3)
  const service = maintenanceService({
    maintenance: fakeMaintenance({ deleteExpiredSessions }),
  })

  const report = await service.runDaily(now)

  expect(deleteExpiredSessions).toHaveBeenCalledTimes(3)
  expect(deleteExpiredSessions).toHaveBeenCalledWith(now, batch)
  expect(report.expiredSessions).toEqual({ processed: batch * 2 + 3 })
})

test('uses each retention period as the cutoff', async () => {
  const m = fakeMaintenance()

  await maintenanceService({ maintenance: m }).runDaily(now)

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
  const service = maintenanceService({
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

  await maintenanceService({
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
  const service = maintenanceService({
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
  const service = maintenanceService({
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
  const service = maintenanceService({
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
  const service = maintenanceService({
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

describe('reconciling deployments left running', () => {
  const MINUTE = 60 * 1000
  const running = (overrides: Partial<DeploymentRecord>): DeploymentRecord => ({
    ...deploymentRecord(),
    startedAt: now - 2 * LIMITS.deploymentWorkflowTimeoutMinutes * MINUTE,
    ...overrides,
  })
  const workflow = (status: Awaited<ReturnType<DeploymentWorkflow['status']>>) => ({
    start: vi.fn(async (_deploymentId: string) => {}),
    status: vi.fn(async (_deploymentId: string) => status),
  })
  const reconcile = async (
    record: DeploymentRecord,
    deps: { workflow?: DeploymentWorkflow; abandoned?: boolean } = {},
  ) => {
    const abandon = vi.fn<DeploymentRepository['abandon']>(async () => deps.abandoned ?? true)
    const listRunning = vi.fn(async () => [record])
    const report = await maintenanceService({
      deployments: fakeDeployments({ listRunning, abandon }),
      workflow: deps.workflow,
    }).runDaily(now)
    const call = abandon.mock.calls[0]?.[0]
    return {
      report: report.reconciledDeployments,
      abandon,
      listRunning,
      log: call ? (JSON.parse(call.log) as Record<string, unknown>) : null,
    }
  }

  test('looks only at deployments accepted long enough ago', async () => {
    const { listRunning } = await reconcile(running({ phase: 'preparing' }))

    expect(listRunning).toHaveBeenCalledWith(now - LIMITS.deploymentReconcileMinutes * MINUTE)
  })

  test('fails one still preparing: no Workflow ran it', async () => {
    const r = running({ phase: 'preparing' })

    const { report, abandon, log } = await reconcile(r, { workflow: workflow('missing') })

    expect(abandon).toHaveBeenCalledWith(
      expect.objectContaining({ id: r.id, phase: 'preparing', executedCount: 0, now }),
    )
    expect(log).toEqual({ code: 'preparation_failed', requiresInspection: false, reconciled: true })
    expect(report).toEqual({ processed: 1, skipped: 0, failed: 0 })
  })

  test('starts a queued one again under the same ID when its Workflow was never created', async () => {
    const r = running({ phase: 'queued' })
    const lost = workflow('missing')

    const { report, abandon } = await reconcile(r, { workflow: lost })

    expect(lost.start).toHaveBeenCalledWith(r.id)
    expect(abandon).not.toHaveBeenCalled()
    expect(report).toEqual({ processed: 1, skipped: 0, failed: 0 })
  })

  test('fails a queued one whose Workflow ended without claiming it', async () => {
    const { log } = await reconcile(running({ phase: 'queued' }), {
      workflow: workflow('finished'),
    })

    expect(log).toMatchObject({ code: 'workflow_failed', requiresInspection: false })
  })

  test('fails a queued one when no Workflow is configured', async () => {
    const { log } = await reconcile(running({ phase: 'queued' }))

    expect(log).toMatchObject({ code: 'workflow_not_configured', requiresInspection: false })
  })

  test('leaves one whose Workflow is still active', async () => {
    for (const phase of ['queued', 'executing'] as const) {
      const active = workflow('active')
      const { report, abandon } = await reconcile(running({ phase }), { workflow: active })

      expect(abandon).not.toHaveBeenCalled()
      expect(active.start).not.toHaveBeenCalled()
      expect(report).toEqual({ processed: 0, skipped: 1, failed: 0 })
    }
  })

  test('fails an executing one whose Workflow ended as outcome unknown, keeping its progress', async () => {
    const r = running({
      phase: 'executing',
      executedCount: 4,
      log: JSON.stringify({ committed: true, lastStep: { index: 3, status: 'succeeded' } }),
    })

    const { abandon, log } = await reconcile(r, { workflow: workflow('finished') })

    expect(abandon).toHaveBeenCalledWith(
      expect.objectContaining({ phase: 'executing', executedCount: 4 }),
    )
    expect(log).toEqual({
      committed: true,
      lastStep: { index: 3, status: 'succeeded' },
      code: 'outcome_unknown',
      requiresInspection: true,
      reconciled: true,
    })
  })

  test('waits out the Workflow time limit before failing an executing one it cannot find', async () => {
    const recent = running({
      phase: 'executing',
      startedAt: now - (LIMITS.deploymentWorkflowTimeoutMinutes - 1) * MINUTE,
    })
    const waited = await reconcile(recent, { workflow: workflow('missing') })
    expect(waited.abandon).not.toHaveBeenCalled()

    const old = running({ phase: 'executing' })
    expect((await reconcile(old, { workflow: workflow('missing') })).log).toMatchObject({
      code: 'outcome_unknown',
    })
  })

  test('one that moved on since it was read counts as skipped', async () => {
    const { report } = await reconcile(running({ phase: 'preparing' }), { abandoned: false })

    expect(report).toEqual({ processed: 0, skipped: 1, failed: 0 })
  })

  test('a failed restart is counted and left for the next run', async () => {
    const lost = workflow('missing')
    lost.start.mockRejectedValueOnce(new Error('Workflows unavailable'))

    const { report } = await reconcile(running({ phase: 'queued' }), { workflow: lost })

    expect(report).toEqual({ processed: 0, skipped: 0, failed: 1 })
  })
})
