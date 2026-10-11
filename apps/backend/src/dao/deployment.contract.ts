import { expect, test } from 'vite-plus/test'

import type { DeploymentDao, DeploymentRecord } from './deployment.interface.ts'

export const deploymentRecord = (): DeploymentRecord => ({
  id: crypto.randomUUID(),
  productId: 'p1',
  databaseId: 'd1',
  connectionId: 'c1',
  connectionName: 'test',
  kind: 'build',
  fromVersionId: null,
  toVersionId: 'v1',
  status: 'running',
  phase: 'preparing',
  executedBy: 'u1',
  startedAt: 1000,
  finishedAt: null,
  log: null,
  idempotencyKey: crypto.randomUUID(),
  requestHash: 'request',
  planHash: 'plan',
  connectionSnapshot: '{}',
  targetRevision: 1,
  sourceRevision: null,
  executedCount: 0,
})
export const deploymentDaoContract = (
  setup: () => Promise<{
    dao: DeploymentDao
    audits: () => Promise<number>
    revision: () => Promise<number>
    changeVersion: () => Promise<void>
  }>,
) => {
  const accept = (dao: DeploymentDao, record: DeploymentRecord) =>
    dao.accept({
      record,
      userId: 'u1',
      allowedRoles: ['owner', 'manager'],
      connectionUpdatedAt: 1000,
      audit: {
        id: crypto.randomUUID(),
        productId: 'p1',
        userId: 'u1',
        targetType: 'deployment',
        action: 'started',
        summary: 'test',
        createdAt: 1000,
      },
    })
  test('competing receipt is atomic and a key resolves to the original execution', async () => {
    const f = await setup(),
      r = deploymentRecord(),
      revision = await f.revision()
    const results = await Promise.allSettled([
      accept(f.dao, r),
      accept(f.dao, { ...deploymentRecord() }),
    ])
    expect(results.filter((v) => v.status === 'fulfilled')).toHaveLength(1)
    expect(await f.audits()).toBe(1)
    expect(await f.revision()).toBe(revision + 1)
    const history = await f.dao.list('d1')
    expect(history).toHaveLength(1)
    expect((await f.dao.findByKey('c1', history[0]!.idempotencyKey))!.id).toBe(history[0]!.id)
  })
  test('stale source does not create history, revisions or audit', async () => {
    const f = await setup(),
      revision = await f.revision()
    await f.changeVersion()
    await expect(accept(f.dao, deploymentRecord())).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.dao.list('d1')).toHaveLength(0)
    expect(await f.audits()).toBe(0)
    expect(await f.revision()).toBe(revision)
  })
  test('execution claim is consumed once and progress cannot regress', async () => {
    const f = await setup(),
      r = deploymentRecord()
    await accept(f.dao, r)
    expect(await f.dao.claim(r.id)).toBe(false)
    expect(await f.dao.queue(r.id)).toBe(true)
    expect(
      (await Promise.all([f.dao.claim(r.id), f.dao.claim(r.id)])).filter(Boolean),
    ).toHaveLength(1)
    await f.dao.progress(r.id, 2, '[]')
    await f.dao.progress(r.id, 1, '{}')
    expect((await f.dao.findById(r.id))!.executedCount).toBe(2)
    await f.dao.finish(r.id, 'failed', '[]', 2000)
    await f.dao.finish(r.id, 'succeeded', '[]', 3000)
    expect(await f.dao.findById(r.id)).toMatchObject({ status: 'failed', finishedAt: 2000 })
    expect(await f.audits()).toBe(2)
  })
  test('lists running deployments and abandons one only as it was read', async () => {
    const f = await setup(),
      r = { ...deploymentRecord(), startedAt: 1000 }
    await accept(f.dao, r)
    expect((await f.dao.listRunning(999)).map((v) => v.id)).toEqual([])
    expect((await f.dao.listRunning(1000)).map((v) => v.id)).toEqual([r.id])
    await f.dao.queue(r.id)
    await f.dao.claim(r.id)
    await f.dao.progress(r.id, 3, '{"committed":true}')
    const revision = await f.revision()
    const abandon = (phase: DeploymentRecord['phase'], executedCount: number) =>
      f.dao.abandon({
        id: r.id,
        phase,
        executedCount,
        log: '{"code":"outcome_unknown"}',
        now: 5000,
      })

    // The executor moved on since it was read: nothing changes.
    expect(await abandon('queued', 0)).toBe(false)
    expect(await abandon('executing', 2)).toBe(false)
    expect(await f.revision()).toBe(revision)

    expect(await abandon('executing', 3)).toBe(true)
    expect(await f.dao.findById(r.id)).toMatchObject({
      status: 'failed',
      phase: 'finished',
      finishedAt: 5000,
      executedCount: 3,
      log: '{"code":"outcome_unknown"}',
    })
    expect(await f.revision()).toBe(revision + 1)
    expect(await f.audits()).toBe(2)
    expect(await abandon('executing', 3)).toBe(false)
    expect(await f.dao.listRunning(5000)).toEqual([])
  })
}
