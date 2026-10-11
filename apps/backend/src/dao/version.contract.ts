import { expect, test } from 'vite-plus/test'

import type { ObjectDao } from './object.interface.ts'
import type { VersionDao, VersionWrite } from './version.interface.ts'
export const versionDaoContract = (
  setup: () => Promise<{
    dao: VersionDao
    objects: ObjectDao
    application: (status: 'running' | 'succeeded') => Promise<void>
    audits: () => Promise<number>
  }>,
) => {
  const arrange = async () => {
    const f = await setup()
    const context = (await f.objects.findContext('v1'))!
    const input: VersionWrite = {
      context,
      userId: 'u1',
      allowedRoles: ['owner', 'manager', 'member'],
      expectedUpdatedAt: context.version.updatedAt,
      expectedRevision: context.version.revision,
      now: 2000,
      audit: {
        id: crypto.randomUUID(),
        productId: 'p1',
        userId: 'u1',
        targetType: 'version',
        action: 'provisional',
        summary: 'db v1',
        createdAt: 2000,
      },
    }
    return { ...f, input }
  }
  test('state changes atomically bump all scopes and reject stale validation', async () => {
    const f = await arrange()
    const original = await f.audits()
    await expect(
      f.dao.transition({
        ...f.input,
        expectedRevision: 0,
        to: 'provisional',
        memo: null,
        acknowledgeApplied: false,
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.audits()).toBe(original)
    const changed = await f.dao.transition({
      ...f.input,
      to: 'provisional',
      memo: 'memo',
      acknowledgeApplied: false,
    })
    expect(changed.version.status).toBe('provisional')
    expect(changed.version.memo).toBe('memo')
    expect(changed.revisions).toEqual({ version: 2, database: 2, product: 2 })
    await expect(
      f.dao.transition({ ...f.input, to: 'provisional', memo: null, acknowledgeApplied: false }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.audits()).toBe(original + 1)
    const reverted = await f.dao.transition({
      ...f.input,
      expectedUpdatedAt: changed.version.updatedAt,
      expectedRevision: 2,
      to: 'editing',
      memo: null,
      acknowledgeApplied: false,
      audit: { ...f.input.audit, id: crypto.randomUUID() },
    })
    expect(reverted.version.status).toBe('editing')
  })
  test('applied designs need acknowledgment; running deployment cannot be unfrozen', async () => {
    const f = await arrange()
    const current = await f.dao.transition({
      ...f.input,
      to: 'provisional',
      memo: null,
      acknowledgeApplied: false,
    })
    const revert = {
      ...f.input,
      expectedUpdatedAt: current.version.updatedAt,
      expectedRevision: 2,
      to: 'editing' as const,
      memo: null,
      acknowledgeApplied: false,
      audit: { ...f.input.audit, id: crypto.randomUUID() },
    }
    await f.application('succeeded')
    await expect(f.dao.transition(revert)).rejects.toThrow()
    await f.application('running')
    await expect(f.dao.transition({ ...revert, acknowledgeApplied: true })).rejects.toThrow()
    expect((await f.objects.findContext('v1'))!.version.status).toBe('provisional')
  })
}
