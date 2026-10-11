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
  const provision = async (f: Awaited<ReturnType<typeof arrange>>) => {
    const context = (await f.objects.findContext('v1'))!
    const saved = await f.dao.transition({
      ...f.input,
      context,
      expectedUpdatedAt: context.version.updatedAt,
      expectedRevision: context.version.revision,
      to: 'provisional',
      memo: null,
      acknowledgeApplied: false,
    })
    return {
      ...f.input,
      context: { ...context, version: saved.version },
      expectedUpdatedAt: saved.version.updatedAt,
      expectedRevision: saved.version.revision,
      audit: { ...f.input.audit, id: crypto.randomUUID(), action: 'finalize' },
    }
  }
  test('finalize compacts tombstones and clones stable keys with fresh rows atomically', async () => {
    const f = await arrange()
    const schemaKey = crypto.randomUUID(),
      tableKey = crypto.randomUUID(),
      columnKey = crypto.randomUUID()
    const put = async (key: string, kind: 'schema' | 'table', name: string, definition: string) =>
      f.objects.save({
        context: (await f.objects.findContext('v1'))!,
        userId: 'u1',
        allowedRoles: ['owner'],
        audit: { ...f.input.audit, id: crypto.randomUUID() },
        now: 1500,
        record: {
          id: crypto.randomUUID(),
          versionId: 'v1',
          objectKey: key,
          kind,
          schemaKey: kind === 'table' ? schemaKey : null,
          name,
          logicalName: null,
          definition,
          updatedBy: 'u1',
          updatedAt: 1500,
          revision: 1,
          deletedAt: null,
        },
        expectedUpdatedAt: null,
        delete: false,
        maxObjects: 100,
        maxBytes: 10000,
      })
    await put(schemaKey, 'schema', 'public', '{}')
    const table = await put(
      tableKey,
      'table',
      'orders',
      JSON.stringify({ columns: [{ key: columnKey, name: 'id' }] }),
    )
    const removed = await put(crypto.randomUUID(), 'table', 'removed', '{}')
    await f.objects.save({
      context: (await f.objects.findContext('v1'))!,
      userId: 'u1',
      allowedRoles: ['owner'],
      audit: { ...f.input.audit, id: crypto.randomUUID() },
      now: 1600,
      record: removed.object,
      expectedUpdatedAt: removed.object.updatedAt,
      delete: true,
      maxObjects: 100,
      maxBytes: 10000,
    })
    const input = await provision(f)
    const count = await f.audits()
    const saved = await f.dao.finalize({
      ...input,
      memo: 'release',
      next: { id: 'v2', audit: { ...input.audit, id: crypto.randomUUID(), action: 'create' } },
    })
    expect(saved.version).toMatchObject({
      status: 'final',
      memo: 'release',
      compactedRevision: saved.version.revision,
      schemaCount: 1,
      tableCount: 1,
    })
    expect(saved.createdVersion).toMatchObject({
      id: 'v2',
      number: 2,
      status: 'editing',
      sourceVersionId: 'v1',
      revision: 1,
      compactedRevision: 1,
    })
    const after = (await f.objects.findScope('v1', input.expectedRevision))!
    expect(after.objects).toHaveLength(2)
    expect(after.objects.some((v) => v.deletedAt !== null)).toBe(false)
    const cloned = (await f.objects.findScope('v2'))!.objects.find((v) => v.objectKey === tableKey)!
    expect(cloned.id).not.toBe(table.object.id)
    expect(cloned.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    )
    expect(JSON.parse(cloned.definition).columns[0].key).toBe(columnKey)
    expect(saved.createdVersion!.definitionBytes).toBe(saved.version.definitionBytes)
    expect(await f.audits()).toBe(count + 2)
    await expect(f.dao.finalize({ ...input, memo: null, next: null })).rejects.toMatchObject({
      code: 'stale_update',
    })
    await expect(
      f.dao.transition({
        ...input,
        expectedUpdatedAt: saved.version.updatedAt,
        expectedRevision: saved.version.revision,
        to: 'editing',
        memo: null,
        acknowledgeApplied: true,
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
  })
  test('creation from an older final version numbers after the latest and one concurrent writer succeeds', async () => {
    const f = await arrange()
    const input = await provision(f)
    const final = await f.dao.finalize({ ...input, memo: null, next: null })
    const cloneInput = {
      ...input,
      expectedUpdatedAt: final.version.updatedAt,
      expectedRevision: final.version.revision,
      clone: { id: 'v2', audit: { ...input.audit, id: crypto.randomUUID(), action: 'create' } },
    }
    const count = await f.audits()
    const attempts = await Promise.allSettled([
      f.dao.create(cloneInput),
      f.dao.create({
        ...cloneInput,
        clone: { id: 'racing', audit: { ...input.audit, id: crypto.randomUUID() } },
      }),
    ])
    expect(attempts.filter((v) => v.status === 'fulfilled')).toHaveLength(1)
    expect(await f.audits()).toBe(count + 1)
    const winner = attempts.find((v) => v.status === 'fulfilled')!
    if (winner.status !== 'fulfilled') throw new Error('missing winner')
    const v2 = winner.value.version
    const c = (await f.objects.findContext(v2.id))!
    const p2 = await f.dao.transition({
      ...input,
      context: c,
      expectedUpdatedAt: v2.updatedAt,
      expectedRevision: 1,
      to: 'provisional',
      memo: null,
      acknowledgeApplied: false,
      audit: { ...input.audit, id: crypto.randomUUID() },
    })
    await f.dao.finalize({
      ...input,
      context: c,
      expectedUpdatedAt: p2.version.updatedAt,
      expectedRevision: p2.version.revision,
      memo: null,
      next: null,
      audit: { ...input.audit, id: crypto.randomUUID() },
    })
    const v3 = await f.dao.create({
      ...cloneInput,
      clone: { id: 'v3', audit: { ...input.audit, id: crypto.randomUUID() } },
    })
    expect(v3.version).toMatchObject({ number: 3, sourceVersionId: 'v1' })
  })
  test('a failure creating the next version rolls back finalization and history', async () => {
    const f = await arrange()
    const input = await provision(f)
    const count = await f.audits()
    // A duplicate primary key must abort the entire transaction.
    await expect(
      f.dao.finalize({
        ...input,
        memo: null,
        next: { id: 'v1', audit: { ...input.audit, id: crypto.randomUUID() } },
      }),
    ).rejects.toThrow()
    expect((await f.objects.findContext('v1'))!.version.status).toBe('provisional')
    expect(await f.audits()).toBe(count)
  })
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
