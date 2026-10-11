import { expect, test } from 'vite-plus/test'

import type { ObjectDao, ObjectRecord, ObjectWrite } from './object.interface.ts'

export const objectDaoContract = (
  setup: () => Promise<{
    dao: ObjectDao
    audits: () => Promise<number>
    removeActor: () => Promise<void>
  }>,
) => {
  const arrange = async () => {
    const f = await setup()
    const context = (await f.dao.findContext('v1'))!
    const input = (name: string): ObjectWrite => ({
      context,
      userId: 'u1',
      allowedRoles: ['owner', 'manager', 'member'],
      now: 1000,
      maxObjects: 1000,
      maxBytes: 10000,
      delete: false,
      expectedUpdatedAt: null,
      audit: {
        id: crypto.randomUUID(),
        productId: 'p1',
        userId: 'u1',
        targetType: 'object',
        action: 'create',
        summary: name,
        createdAt: 1000,
      },
      record: {
        id: crypto.randomUUID(),
        versionId: 'v1',
        objectKey: crypto.randomUUID(),
        kind: 'table',
        schemaKey: 'schema',
        name,
        logicalName: null,
        definition: '{}',
        updatedBy: 'u1',
        updatedAt: 1000,
        revision: 0,
        deletedAt: null,
      },
    })
    return { ...f, input }
  }
  test('independent objects, object conflicts, atomic revisions, and tombstones', async () => {
    const f = await arrange()
    const a = await f.dao.save(f.input('a'))
    const b = await f.dao.save(f.input('b'))
    const update = { ...f.input('a'), record: a.object, expectedUpdatedAt: a.object.updatedAt }
    const saved = await f.dao.save(update)
    expect(saved.revisions.version).toBe(4)
    expect((await f.dao.findContext('v1'))!.version.tableCount).toBe(2)
    const before = await f.audits()
    await expect(f.dao.save(update)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.audits()).toBe(before)
    expect((await f.dao.findContext('v1'))!.version.revision).toBe(4)
    const removed = await f.dao.save({
      ...f.input('b'),
      record: b.object,
      expectedUpdatedAt: b.object.updatedAt,
      delete: true,
    })
    expect(removed.object.deletedAt).toBe(1000)
    expect((await f.dao.findScope('v1', 4))!.objects.map((o) => o.objectKey)).toEqual([
      b.object.objectKey,
    ])
    expect((await f.dao.findScope('v1'))!.objects).toHaveLength(2)
    expect((await f.dao.findContext('v1'))!.version.definitionBytes).toBe(4)
  })
  test('limits, duplicate names, and changed membership roll back every side effect', async () => {
    const f = await arrange()
    await f.dao.save(f.input('a'))
    const before = await f.audits()
    await expect(f.dao.save(f.input('a'))).rejects.toMatchObject({ code: 'duplicate' })
    await expect(f.dao.save({ ...f.input('b'), maxObjects: 2 })).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    await expect(f.dao.save({ ...f.input('c'), maxBytes: 4 })).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    expect(await f.audits()).toBe(before)
    expect((await f.dao.findContext('v1'))!.version.revision).toBe(2)
    await f.removeActor()
    await expect(f.dao.save(f.input('d'))).rejects.toMatchObject({ code: 'stale_update' })
  })
  test('two updates from the same timestamp permit exactly one writer', async () => {
    const f = await arrange()
    const original = await f.dao.save(f.input('a'))
    const update = () => ({
      ...f.input('a'),
      record: original.object as ObjectRecord,
      expectedUpdatedAt: original.object.updatedAt,
    })
    const results = await Promise.allSettled([f.dao.save(update()), f.dao.save(update())])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((await f.dao.findContext('v1'))!.version.revision).toBe(3)
  })
  test('a design changed during view validation cannot be saved', async () => {
    const f = await arrange()
    const input = f.input('view')
    await f.dao.save(f.input('table'))
    await expect(f.dao.save({ ...input, expectedRevision: 1 })).rejects.toMatchObject({
      code: 'stale_update',
    })
    expect((await f.dao.findContext('v1'))!.version.revision).toBe(2)
  })
}
