import { afterEach, beforeEach, expect, test, vi } from 'vite-plus/test'

import { createMemoryDb } from '../dao/memory-db.ts'
import type { UserDao } from '../dao/user.interface.ts'
import { createUserMemoryDao } from '../dao/user.memory.ts'
import { createSessionToken, hashSessionToken } from '../service/session-token.ts'
import { createSessionAuthGuard } from './auth-guard.session.ts'

let users: UserDao
let token: string

beforeEach(async () => {
  vi.useFakeTimers({ now: 1000 })
  users = createUserMemoryDao(createMemoryDb())
  token = createSessionToken()
  await users.register(
    {
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
    },
    { id: await hashSessionToken(token), userId: 'u1', expiresAt: 5000, createdAt: 0 },
  )
})

afterEach(() => {
  vi.useRealTimers()
})

const guard = () => createSessionAuthGuard({ users, cookieName: '__Host-session' })
const request = (cookie?: string) =>
  new Request('http://localhost/api/x', cookie ? { headers: { cookie } } : {})

test('authenticates the user of a valid session cookie', async () => {
  expect(await guard().authenticate(request(`other=1; __Host-session=${token}`))).toEqual({
    id: 'u1',
    name: 'はなこ',
    email: 'a@example.com',
    termsVersion: 'v1',
    sessionId: await hashSessionToken(token),
  })
})

test.each([
  ['no cookie', () => request()],
  ['an unknown token', () => request(`__Host-session=${createSessionToken()}`)],
  ['the token under another cookie name', () => request(`session=${token}`)],
])('rejects %s', async (_, make) => {
  expect(await guard().authenticate(make())).toBeNull()
})

test('rejects an expired session', async () => {
  vi.setSystemTime(5000)

  expect(await guard().authenticate(request(`__Host-session=${token}`))).toBeNull()
})

test('rejects a deleted session', async () => {
  await users.deleteSession(await hashSessionToken(token))

  expect(await guard().authenticate(request(`__Host-session=${token}`))).toBeNull()
})
