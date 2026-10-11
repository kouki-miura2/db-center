import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'
import { TERMS_VERSION } from 'utils'
import { beforeAll, beforeEach, expect, test } from 'vite-plus/test'

import { createApp, SESSION_COOKIE } from './app.ts'
import { createMemoryDb, type MemoryDb, memoryTable } from './dao/memory-db.ts'
import { createUserMemoryDao } from './dao/user.memory.ts'
import type { GoogleIdTokenVerifier } from './repository/google-id-token.interface.ts'
import { createGoogleIdTokenVerifier } from './repository/google-id-token.jose.ts'
import { createUserRepository } from './repository/user.repository.ts'
import { createAuthService } from './service/auth.service.ts'
import { hashSessionToken } from './service/session-token.ts'

const CLIENT_ID = 'client-id.apps.example'
let key: CryptoKey
let verifier: GoogleIdTokenVerifier
let db: MemoryDb
let app: ReturnType<typeof createApp>

beforeAll(async () => {
  const pair = await generateKeyPair('RS256')
  key = pair.privateKey
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' }
  verifier = createGoogleIdTokenVerifier({
    clientId: CLIENT_ID,
    keys: createLocalJWKSet({ keys: [jwk] }),
  })
})

beforeEach(() => {
  db = createMemoryDb()
  app = createApp({
    sampleService: { getSample: async () => null },
    authService: createAuthService({
      verifier,
      users: createUserRepository(createUserMemoryDao(db)),
    }),
    auth: { guard: { authenticate: async () => null }, enabled: false, excludePaths: [] },
    sessionCookie: SESSION_COOKIE.production,
  })
})

const idToken = (claims: JWTPayload = {}) =>
  new SignJWT({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: 'google-1',
    email: 'hanako@example.com',
    email_verified: true,
    name: '佐藤 花子',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(key)

const post = (path: string, body: unknown) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

const register = async (body: Record<string, unknown> = {}) =>
  post('/api/auth/register', {
    idToken: await idToken(),
    name: 'はなこ',
    termsVersion: TERMS_VERSION,
    agreed: true,
    ...body,
  })

const sessionToken = (res: Response) =>
  /__Host-session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')?.[1]

test('an unregistered account is told to consent, and nothing is stored', async () => {
  const res = await post('/api/auth/google', { idToken: await idToken() })

  expect(await res.json()).toEqual({
    status: 'registration_required',
    email: 'hanako@example.com',
    suggestedName: '佐藤 花子',
  })
  expect(res.headers.get('set-cookie')).toBeNull()
  expect(memoryTable(db, 'users').size).toBe(0)
  expect(memoryTable(db, 'sessions').size).toBe(0)
})

test('registering with consent creates the user and a session cookie', async () => {
  const res = await register()

  expect(res.status).toBe(200)
  const body = await res.json()
  expect(body).toEqual({
    status: 'signed_in',
    user: { id: expect.any(String), name: 'はなこ', email: 'hanako@example.com' },
    consentRequired: false,
  })
  expect(JSON.stringify(body)).not.toContain(sessionToken(res))
  const cookie = res.headers.get('set-cookie') ?? ''
  expect(cookie).toMatch(/HttpOnly/)
  expect(cookie).toMatch(/Secure/)
  expect(cookie).toMatch(/SameSite=Lax/)
  expect(cookie).toMatch(/Path=\//)
  expect(cookie).not.toMatch(/Domain/)
  // Only the token's hash is stored.
  const [session] = [...memoryTable<{ id: string }>(db, 'sessions').values()]
  expect(session?.id).toBe(await hashSessionToken(sessionToken(res) as string))
})

test('a registered user signs in and gets a new session', async () => {
  await register()

  const res = await post('/api/auth/google', { idToken: await idToken() })

  expect(await res.json()).toMatchObject({ status: 'signed_in', consentRequired: false })
  expect(sessionToken(res)).toBeDefined()
  expect(memoryTable(db, 'sessions').size).toBe(2)
})

test('signing in keeps the account by sub and updates a changed email', async () => {
  await register()

  await post('/api/auth/google', { idToken: await idToken({ email: 'new@example.com' }) })

  const [user] = [...memoryTable<{ email: string }>(db, 'users').values()]
  expect(user?.email).toBe('new@example.com')
})

test('a user who agreed to an older terms version must consent again', async () => {
  await register()
  memoryTable<{ termsVersion: string }>(db, 'users').forEach((user) => {
    user.termsVersion = 'old'
  })

  const res = await post('/api/auth/google', { idToken: await idToken() })

  expect(await res.json()).toMatchObject({ status: 'signed_in', consentRequired: true })
})

test.each([
  ['without agreeing', { agreed: false }],
  ['with a blank name', { name: '   ' }],
  ['with a name over the limit', { name: 'あ'.repeat(31) }],
])('refuses to register %s', async (_, body) => {
  const res = await register(body)

  expect(res.status).toBe(400)
  expect(memoryTable(db, 'users').size).toBe(0)
})

test('refuses to register against an outdated terms version', async () => {
  const res = await register({ termsVersion: 'old' })

  expect(res.status).toBe(409)
  expect(memoryTable(db, 'users').size).toBe(0)
})

test('refuses to register the same Google account twice', async () => {
  await register()

  const res = await register()

  expect(res.status).toBe(409)
  expect(memoryTable(db, 'users').size).toBe(1)
})

test.each([
  ['/api/auth/google', () => ({})],
  ['/api/auth/register', () => ({ name: 'はなこ', termsVersion: TERMS_VERSION, agreed: true })],
])('rejects an invalid ID token on %s with 401', async (path, body) => {
  const res = await post(path, { ...body(), idToken: await idToken({ aud: 'another-app' }) })

  expect(res.status).toBe(401)
  expect(memoryTable(db, 'users').size).toBe(0)
})
