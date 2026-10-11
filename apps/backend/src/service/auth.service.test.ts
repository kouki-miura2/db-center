import { TERMS_VERSION } from 'utils'
import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { SessionRecord, UserRecord } from '../dao/user.interface.ts'
import { AppError } from '../error.ts'
import type { GoogleIdTokenVerifier } from '../repository/google-id-token.interface.ts'
import type { User, UserRepository } from '../repository/user.repository.ts'
import { createAuthService } from './auth.service.ts'
import { hashSessionToken } from './session-token.ts'

afterEach(() => {
  vi.useRealTimers()
})

const identity = { sub: 'sub-1', email: 'a@example.com', name: '佐藤 花子' }
const verifier = (valid = true): GoogleIdTokenVerifier => ({
  verify: async () => (valid ? identity : null),
})
const existing: User = {
  id: 'u1',
  name: 'はなこ',
  email: 'a@example.com',
  termsVersion: TERMS_VERSION,
}

// A hand-written UserRepository that records what the service asked it to store.
const fakeUsers = (found: User | null, overrides: Partial<UserRepository> = {}) => {
  const calls = {
    registered: [] as UserRecord[],
    sessions: [] as SessionRecord[],
    deleted: [] as string[],
  }
  const users: UserRepository = {
    findByGoogleSub: async () => found,
    register: async (user, session) => {
      calls.registered.push(user)
      calls.sessions.push(session)
      return {
        id: user.id,
        name: user.name,
        email: identity.email,
        termsVersion: user.termsVersion,
      }
    },
    recordLogin: async (login, session) => {
      calls.sessions.push(session)
      return { ...existing, ...found, email: login.email }
    },
    deleteSession: async (sessionId) => {
      calls.deleted.push(sessionId)
    },
    ...overrides,
  }
  return { users, calls }
}

test('asks an unknown account to consent without storing anything', async () => {
  const { users, calls } = fakeUsers(null)

  const result = await createAuthService({ verifier: verifier(), users }).signInWithGoogle('t')

  expect(result).toEqual({
    status: 'registration_required',
    email: 'a@example.com',
    suggestedName: '佐藤 花子',
  })
  expect(calls.sessions).toEqual([])
})

test('signs a registered user in with a session valid for the session period', async () => {
  vi.useFakeTimers({ now: 1000 })
  const { users, calls } = fakeUsers(existing)

  const result = await createAuthService({ verifier: verifier(), users }).signInWithGoogle('t')

  expect(result).toMatchObject({ status: 'signed_in', consentRequired: false })
  if (result.status !== 'signed_in') throw new Error('expected signed_in')
  expect(calls.sessions[0]).toEqual({
    id: await hashSessionToken(result.session.token),
    userId: 'u1',
    expiresAt: 1000 + 30 * 24 * 60 * 60 * 1000,
    createdAt: 1000,
  })
})

test('requires consent again from a user on an older terms version', async () => {
  const { users } = fakeUsers({ ...existing, termsVersion: 'old' })

  const result = await createAuthService({ verifier: verifier(), users }).signInWithGoogle('t')

  expect(result).toMatchObject({ consentRequired: true })
})

test('rejects an invalid token as unauthorized', async () => {
  const { users } = fakeUsers(existing)

  await expect(
    createAuthService({ verifier: verifier(false), users }).signInWithGoogle('t'),
  ).rejects.toMatchObject({ code: 'unauthorized' })
})

test('registers a new user with the consented terms version', async () => {
  const { users, calls } = fakeUsers(null)

  await createAuthService({ verifier: verifier(), users }).register({
    idToken: 't',
    name: 'はなこ',
    termsVersion: TERMS_VERSION,
  })

  expect(calls.registered[0]).toMatchObject({
    googleSub: 'sub-1',
    email: 'a@example.com',
    name: 'はなこ',
    termsVersion: TERMS_VERSION,
    deletedAt: null,
  })
})

test('refuses to register against an outdated terms version', async () => {
  const { users, calls } = fakeUsers(null)

  await expect(
    createAuthService({ verifier: verifier(), users }).register({
      idToken: 't',
      name: 'はなこ',
      termsVersion: 'old',
    }),
  ).rejects.toMatchObject({ code: 'invalid_state' })
  expect(calls.registered).toEqual([])
})

test('reports a concurrent registration of the same account as already registered', async () => {
  const { users } = fakeUsers(null, {
    register: async () => {
      throw new AppError('duplicate')
    },
  })

  await expect(
    createAuthService({ verifier: verifier(), users }).register({
      idToken: 't',
      name: 'はなこ',
      termsVersion: TERMS_VERSION,
    }),
  ).rejects.toMatchObject({ code: 'invalid_state' })
})

test('signs out by deleting the hashed session', async () => {
  const { users, calls } = fakeUsers(existing)

  await createAuthService({ verifier: verifier(), users }).signOut('token')

  expect(calls.deleted).toEqual([await hashSessionToken('token')])
})
