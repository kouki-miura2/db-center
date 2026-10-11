import { expect, test } from 'vite-plus/test'

import type { SessionRecord, UserDao, UserRecord } from './user.interface.ts'

/**
 * Behavior every `UserDao` must share, run against the in-memory DAO here and the D1 DAO in the
 * runtime package. `setup` returns a fresh, empty DAO plus a way to count stored sessions.
 */
export interface UserDaoFixture {
  dao: UserDao
  countSessions: () => Promise<number>
  /** Adds a product (revision 1) and its owner's membership directly. */
  addProduct: (productId: string, ownerId: string, deleted?: boolean) => Promise<void>
  addMember: (productId: string, userId: string, role: 'manager' | 'member') => Promise<void>
  countMemberships: (userId: string) => Promise<number>
  productRevision: (productId: string) => Promise<number>
  /** The audit log entries as [productId, action, summary]. */
  auditLogs: () => Promise<[string, string, string][]>
}

export const userDaoContract = (setup: () => Promise<UserDaoFixture>) => {
  const user = (overrides: Partial<UserRecord> = {}): UserRecord => ({
    id: 'u1',
    googleSub: 'sub-1',
    email: 'a@example.com',
    name: 'はなこ',
    termsVersion: '2026-10-11',
    agreedAt: 1000,
    lastLoginAt: 1000,
    productsRevision: 1,
    createdAt: 1000,
    deletedAt: null,
    ...overrides,
  })
  const session = (id: string, userId = 'u1'): SessionRecord => ({
    id,
    userId,
    expiresAt: 9000,
    createdAt: 1000,
  })

  test('registers a user with a session and finds them by Google account', async () => {
    const { dao, countSessions } = await setup()

    await dao.register(user(), session('s1'))

    expect(await dao.findByGoogleSub('sub-1')).toEqual(user())
    expect(await dao.findByGoogleSub('sub-2')).toBeNull()
    expect(await countSessions()).toBe(1)
  })

  test('refuses a second user for the same Google account, creating no session', async () => {
    const { dao, countSessions } = await setup()
    await dao.register(user(), session('s1'))

    await expect(dao.register(user({ id: 'u2' }), session('s2', 'u2'))).rejects.toMatchObject({
      code: 'duplicate',
    })
    expect(await countSessions()).toBe(1)
  })

  test('records a sign-in and its session together', async () => {
    const { dao, countSessions } = await setup()
    await dao.register(user(), session('s1'))

    const updated = await dao.recordLogin(
      { userId: 'u1', email: 'new@example.com', lastLoginAt: 2000 },
      session('s2'),
    )

    expect(updated).toMatchObject({ email: 'new@example.com', lastLoginAt: 2000 })
    expect(await dao.findByGoogleSub('sub-1')).toMatchObject({ email: 'new@example.com' })
    expect(await countSessions()).toBe(2)
  })

  test('finds the user of a session only until it expires', async () => {
    const { dao } = await setup()
    await dao.register(user(), session('s1')) // expires at 9000

    expect(await dao.findSessionUser('s1', 8999)).toEqual(user())
    expect(await dao.findSessionUser('s1', 9000)).toBeNull()
    expect(await dao.findSessionUser('unknown', 1000)).toBeNull()
  })

  test('deletes a session, leaving the user’s other sessions', async () => {
    const { dao, countSessions } = await setup()
    await dao.register(user(), session('s1'))
    await dao.recordLogin(
      { userId: 'u1', email: 'a@example.com', lastLoginAt: 2000 },
      session('s2'),
    )

    await dao.deleteSession('s1')
    await dao.deleteSession('s1')

    expect(await dao.findSessionUser('s1', 1000)).toBeNull()
    expect(await dao.findSessionUser('s2', 1000)).not.toBeNull()
    expect(await countSessions()).toBe(1)
  })

  test('records consent to a new terms version', async () => {
    const { dao } = await setup()
    await dao.register(user(), session('s1'))

    const updated = await dao.recordConsent({ userId: 'u1', termsVersion: 'v2', agreedAt: 3000 })

    expect(updated).toMatchObject({ termsVersion: 'v2', agreedAt: 3000 })
    expect(await dao.findByGoogleSub('sub-1')).toMatchObject({ termsVersion: 'v2' })
  })

  test('records no consent for a user who is gone', async () => {
    const { dao } = await setup()

    await expect(
      dao.recordConsent({ userId: 'missing', termsVersion: 'v2', agreedAt: 3000 }),
    ).rejects.toMatchObject({ code: 'stale_update' })
  })

  test('creates no session when the user is gone', async () => {
    const { dao, countSessions } = await setup()

    await expect(
      dao.recordLogin(
        { userId: 'missing', email: 'a@example.com', lastLoginAt: 2000 },
        session('s1'),
      ),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await countSessions()).toBe(0)
  })

  const withdraw = (dao: UserDao) =>
    dao.withdraw({ userId: 'u1', name: 'はなこ', anonymizedName: '退会したユーザー', now: 5000 })

  test('withdraws: leaves products, deletes sessions, forgets the Google account', async () => {
    const f = await setup()
    await f.dao.register(user(), session('s1'))
    await f.dao.recordLogin(
      { userId: 'u1', email: 'a@example.com', lastLoginAt: 2000 },
      session('s2'),
    )
    await f.dao.register(user({ id: 'u2', googleSub: 'sub-2' }), session('s3', 'u2'))
    await f.addProduct('p1', 'u2')
    await f.addMember('p1', 'u1', 'manager')
    await f.addProduct('p2', 'u1', true)

    await withdraw(f.dao)

    expect(await f.dao.findByGoogleSub('sub-1')).toBeNull()
    expect(await f.dao.findSessionUser('s1', 1000)).toBeNull()
    expect(await f.countSessions()).toBe(1)
    // The deleted product's owner row stays until it's purged.
    expect(await f.countMemberships('u1')).toBe(1)
    expect(await f.productRevision('p1')).toBe(2)
    expect(await f.auditLogs()).toEqual([['p1', 'leave', 'はなこ']])
    // A new registration with the same Google account is a new user.
    await f.dao.register(user({ id: 'u3' }), session('s4', 'u3'))
    expect((await f.dao.findByGoogleSub('sub-1'))?.id).toBe('u3')
  })

  test('refuses to withdraw the owner of a product that isn’t deleted, changing nothing', async () => {
    const f = await setup()
    await f.dao.register(user(), session('s1'))
    await f.addProduct('p1', 'u1')

    await expect(withdraw(f.dao)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.dao.findByGoogleSub('sub-1')).not.toBeNull()
    expect(await f.countSessions()).toBe(1)
  })
}
