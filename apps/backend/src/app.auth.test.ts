import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'
import { TERMS_VERSION } from 'utils'
import { beforeAll, beforeEach, expect, test } from 'vite-plus/test'

import { type AppDependencies, createApp, PUBLIC_PATHS, SESSION_COOKIE } from './app.ts'
import { createMemoryDb, type MemoryDb, memoryTable } from './dao/memory-db.ts'
import { createProductMemoryDao } from './dao/product.memory.ts'
import { createUserMemoryDao } from './dao/user.memory.ts'
import { createSessionAuthGuard } from './repository/auth-guard.session.ts'
import type { GoogleIdTokenVerifier } from './repository/google-id-token.interface.ts'
import { createGoogleIdTokenVerifier } from './repository/google-id-token.jose.ts'
import { createProductRepository } from './repository/product.repository.ts'
import { createUserRepository } from './repository/user.repository.ts'
import { createAuthService } from './service/auth.service.ts'
import { createProductService } from './service/product.service.ts'
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
  const users = createUserMemoryDao(db)
  app = createApp({
    authService: createAuthService({ verifier, users: createUserRepository(users) }),
    productService: createProductService({
      products: createProductRepository(createProductMemoryDao(db)),
    }),
    connectionService: {} as AppDependencies['connectionService'],
    // As in production: every path needs a session except the public ones.
    auth: {
      guard: createSessionAuthGuard({ users, cookieName: SESSION_COOKIE.production.name }),
      enabled: true,
      excludePaths: PUBLIC_PATHS,
    },
    sessionCookie: SESSION_COOKIE.production,
    devLogin: false,
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

const me = (token?: string) =>
  app.request('/api/auth/me', token ? { headers: { cookie: `__Host-session=${token}` } } : {})

const logout = (token?: string) =>
  app.request('/api/auth/logout', {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'same-origin',
      ...(token ? { cookie: `__Host-session=${token}` } : {}),
    },
  })

test('the session cookie authenticates later requests', async () => {
  const token = sessionToken(await register())

  const res = await me(token)

  expect(await res.json()).toEqual({
    user: { id: expect.any(String), name: 'はなこ', email: 'hanako@example.com' },
    consentRequired: false,
  })
})

test('a request without a valid session is 401', async () => {
  expect((await me()).status).toBe(401)
  expect((await me('forged-token')).status).toBe(401)
})

test('an expired session is 401', async () => {
  const token = sessionToken(await register())
  memoryTable<{ expiresAt: number }>(db, 'sessions').forEach((session) => {
    session.expiresAt = Date.now() - 1
  })

  expect((await me(token)).status).toBe(401)
})

test('logging out ends the session and clears the cookie', async () => {
  const token = sessionToken(await register())

  const res = await logout(token)

  expect(res.status).toBe(204)
  expect(res.headers.get('set-cookie')).toMatch(/__Host-session=;.*Max-Age=0/)
  expect(memoryTable(db, 'sessions').size).toBe(0)
  expect((await me(token)).status).toBe(401)
})

test('logging out only ends this session', async () => {
  const first = sessionToken(await register())
  const second = sessionToken(await post('/api/auth/google', { idToken: await idToken() }))

  await logout(first)

  expect((await me(second)).status).toBe(200)
})

test('logging out without a session still succeeds', async () => {
  expect((await logout()).status).toBe(204)
})

// A registered user whose agreed terms version is outdated, with a session cookie.
const outdatedUser = async () => {
  const token = sessionToken(await register())
  memoryTable<{ termsVersion: string }>(db, 'users').forEach((user) => {
    user.termsVersion = 'old'
  })
  return token as string
}

const withSession = (token: string, init: { method?: string; body?: string } = {}) => ({
  ...init,
  headers: {
    cookie: `__Host-session=${token}`,
    'sec-fetch-site': 'same-origin',
    'content-type': 'application/json',
  },
})

test('a user on an older terms version is refused everything but their account and consent', async () => {
  const token = await outdatedUser()

  // Any other path is refused before it is reached.
  const refused = await app.request('/api/products', withSession(token))
  expect(refused.status).toBe(403)
  expect(await refused.json()).toMatchObject({ error: { code: 'consent_required' } })

  expect(await (await me(token)).json()).toMatchObject({ consentRequired: true })
})

test('agreeing to the current terms lets the user in again', async () => {
  const token = await outdatedUser()

  const res = await app.request(
    '/api/auth/consent',
    withSession(token, {
      method: 'POST',
      body: JSON.stringify({ termsVersion: TERMS_VERSION, agreed: true }),
    }),
  )

  expect(await res.json()).toMatchObject({ consentRequired: false })
  expect(await (await me(token)).json()).toMatchObject({ consentRequired: false })
  // Past the consent check now.
  expect((await app.request('/api/products', withSession(token))).status).toBe(200)
})

test.each([
  ['without agreeing', { termsVersion: TERMS_VERSION, agreed: false }, 400],
  ['to an outdated version', { termsVersion: 'old', agreed: true }, 409],
])('refuses consent %s', async (_, body, status) => {
  const token = await outdatedUser()

  const res = await app.request(
    '/api/auth/consent',
    withSession(token, { method: 'POST', body: JSON.stringify(body) }),
  )

  expect(res.status).toBe(status)
  expect(await (await me(token)).json()).toMatchObject({ consentRequired: true })
})

test('a user on an older terms version can still log out', async () => {
  const token = await outdatedUser()

  expect((await logout(token)).status).toBe(204)
})
