import { expect, test } from 'vite-plus/test'

import type { SessionRecord, UserDao, UserRecord } from '../dao/user.interface.ts'
import { createUserRepository } from './user.repository.ts'

const record = (overrides: Partial<UserRecord> = {}): UserRecord => ({
  id: 'u1',
  googleSub: 'sub-1',
  email: 'a@example.com',
  name: 'はなこ',
  termsVersion: 'v1',
  agreedAt: 0,
  lastLoginAt: 0,
  productsRevision: 1,
  createdAt: 0,
  deletedAt: null,
  ...overrides,
})
const session: SessionRecord = { id: 's1', userId: 'u1', expiresAt: 1, createdAt: 0 }

const fakeDao = (found: UserRecord | null): UserDao => ({
  findByGoogleSub: async () => found,
  register: async () => {},
  recordLogin: async (login) => record({ email: login.email, lastLoginAt: login.lastLoginAt }),
  findSessionUser: async () => found,
  deleteSession: async () => {},
  recordConsent: async (consent) => record({ termsVersion: consent.termsVersion }),
})

test('maps a stored user to the domain user', async () => {
  const repository = createUserRepository(fakeDao(record()))

  expect(await repository.findByGoogleSub('sub-1')).toEqual({
    id: 'u1',
    name: 'はなこ',
    email: 'a@example.com',
    termsVersion: 'v1',
  })
})

test('treats a withdrawn user as not found', async () => {
  const repository = createUserRepository(
    fakeDao(record({ deletedAt: 5, googleSub: null, email: null })),
  )

  expect(await repository.findByGoogleSub('sub-1')).toBeNull()
})

test('returns the registered, signed-in and consenting user in the domain shape', async () => {
  const repository = createUserRepository(fakeDao(null))

  expect(
    await repository.recordConsent({ userId: 'u1', termsVersion: 'v2', agreedAt: 2 }),
  ).toMatchObject({ termsVersion: 'v2' })
  expect(await repository.register(record(), session)).toMatchObject({ id: 'u1' })
  expect(
    await repository.recordLogin({ userId: 'u1', email: 'b@example.com', lastLoginAt: 2 }, session),
  ).toMatchObject({ email: 'b@example.com' })
})
