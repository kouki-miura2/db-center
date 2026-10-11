import { expect, test } from 'vite-plus/test'

import type { SessionRecord, UserDao, UserRecord } from './user.interface.ts'

/**
 * Behavior every `UserDao` must share, run against the in-memory DAO here and the D1 DAO in the
 * runtime package. `setup` returns a fresh, empty DAO plus a way to count stored sessions.
 */
export const userDaoContract = (
  setup: () => Promise<{ dao: UserDao; countSessions: () => Promise<number> }>,
) => {
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
}
