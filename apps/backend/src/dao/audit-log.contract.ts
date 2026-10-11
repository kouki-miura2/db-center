import { expect, test } from 'vite-plus/test'

import type { AuditLogDao } from './audit-log.dao.interface.ts'

/** Access to the store underneath an `AuditLogDao`, for arranging the tests. */
export interface AuditLogDaoFixture {
  dao: AuditLogDao
  /** Adds an entry by user u1 (named はなこ) directly. Products p1 and p2 exist. */
  addEntry: (id: string, productId: string, createdAt: number) => Promise<void>
  /** Renames u1, as withdrawing does. */
  renameUser: (name: string) => Promise<void>
}

/** Behavior every `AuditLogDao` must share. */
export const auditLogDaoContract = (setup: () => Promise<AuditLogDaoFixture>) => {
  // Five entries in p1, two of them at the same time, and one in p2.
  const arrange = async () => {
    const f = await setup()
    await f.addEntry('a1', 'p1', 1000)
    await f.addEntry('a2', 'p1', 2000)
    await f.addEntry('a3', 'p1', 2000)
    await f.addEntry('a4', 'p1', 3000)
    await f.addEntry('a5', 'p1', 4000)
    await f.addEntry('b1', 'p2', 2500)
    return f
  }
  const ids = async (f: AuditLogDaoFixture, input: Partial<Parameters<AuditLogDao['list']>[0]>) =>
    (await f.dao.list({ productId: 'p1', limit: 10, ...input })).map((entry) => entry.id)

  test('lists a product’s newest entries first, with the actor’s name', async () => {
    const f = await arrange()

    const entries = await f.dao.list({ productId: 'p1', limit: 2 })

    expect(entries.map((entry) => entry.id)).toEqual(['a5', 'a4'])
    expect(entries[0]).toMatchObject({
      productId: 'p1',
      userId: 'u1',
      userName: 'はなこ',
      createdAt: 4000,
    })
  })

  test('pages through entries at the same time without skipping or repeating any', async () => {
    const f = await arrange()

    const first = await ids(f, { limit: 2 })
    const second = await ids(f, { limit: 2, before: { createdAt: 3000, id: 'a4' } })
    // Each page starts after the last entry of the one before.
    const third = await ids(f, { limit: 2, before: { createdAt: 2000, id: 'a2' } })

    expect([...first, ...second, ...third]).toEqual(['a5', 'a4', 'a3', 'a2', 'a1'])
  })

  test('lists only the entries newer than a position', async () => {
    const f = await arrange()

    expect(await ids(f, { after: { createdAt: 2000, id: 'a2' } })).toEqual(['a5', 'a4', 'a3'])
    expect(await ids(f, { after: { createdAt: 4000, id: 'a5' } })).toEqual([])
  })

  test('shows the actor’s current name, as when they withdrew', async () => {
    const f = await arrange()
    await f.renameUser('退会したユーザー')

    const [entry] = await f.dao.list({ productId: 'p1', limit: 1 })

    expect(entry?.userName).toBe('退会したユーザー')
  })
}
