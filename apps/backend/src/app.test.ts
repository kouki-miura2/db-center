import { TERMS_VERSION } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import { type AppDependencies, createApp, PUBLIC_PATHS, SESSION_COOKIE } from './app.ts'
import type { AuthGuard } from './repository/auth-guard.interface.ts'
import type { AuthService } from './service/auth.service.ts'

// Cross-cutting behavior of the app (auth guard, logging, errors, headers, CSRF, dev login),
// with a fake AuthService. The auth routes themselves are covered in `app.auth.test.ts`.

const allowAllGuard: AuthGuard = {
  authenticate: async () => ({
    id: 'test-user',
    name: 'テスト',
    email: 'test@example.com',
    termsVersion: TERMS_VERSION,
    sessionId: 's1',
  }),
}
const denyAllGuard: AuthGuard = { authenticate: async () => null }
const unused = async () => {
  throw new Error('unused')
}
const fakeAuthService: AuthService = {
  signInWithGoogle: unused,
  register: unused,
  signOut: async () => {},
  consent: unused,
  devSignIn: async ({ email, name }) => ({
    status: 'signed_in',
    user: { id: 'dev-user', name, email },
    consentRequired: false,
    session: { token: 'dev-token', expiresAt: Date.now() + 60_000 },
  }),
}

const app = (overrides: Partial<AppDependencies> = {}) =>
  createApp({
    authService: fakeAuthService,
    productService: {
      listProducts: unused,
      createProduct: unused,
      renameProduct: unused,
    },
    auth: { guard: denyAllGuard, enabled: true, excludePaths: [] },
    sessionCookie: SESSION_COOKIE.development,
    devLogin: false,
    ...overrides,
  })

const sameOriginPost = (body?: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})

test('rejects unauthenticated requests while the auth guard is enabled', async () => {
  const res = await app().request('/api/auth/me')

  expect(res.status).toBe(401)
  expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } })
})

test('lets authenticated requests through', async () => {
  const res = await app({
    auth: { guard: allowAllGuard, enabled: true, excludePaths: [] },
  }).request('/api/auth/me')

  expect(await res.json()).toEqual({
    user: { id: 'test-user', name: 'テスト', email: 'test@example.com' },
    consentRequired: false,
  })
})

test('keeps excluded paths open while the auth guard is enabled', async () => {
  const res = await app({
    auth: { guard: denyAllGuard, enabled: true, excludePaths: ['/api/auth/logout'] },
  }).request('/api/auth/logout', sameOriginPost())

  expect(res.status).toBe(204)
})

test('a route that needs the user still refuses when the guard is off', async () => {
  const res = await app({
    auth: { guard: allowAllGuard, enabled: false, excludePaths: [] },
  }).request('/api/auth/me')

  expect(res.status).toBe(401)
})

test('logs a matching started/completed pair, including for a rejected request', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})

  const res = await app().request('/api/auth/me')
  expect(res.status).toBe(401)

  expect(info).toHaveBeenCalledTimes(2)
  const [startedLine] = info.mock.calls[0] as [string]
  const [completedLine] = info.mock.calls[1] as [string]
  const started = JSON.parse(startedLine)
  const completed = JSON.parse(completedLine)

  expect(started).toMatchObject({
    message: 'request started',
    method: 'GET',
    path: '/api/auth/me',
  })
  expect(completed).toMatchObject({
    message: 'request completed',
    method: 'GET',
    path: '/api/auth/me',
    user: 'anonymous',
    status: 401,
  })
  expect(completed.requestId).toBe(started.requestId)
  expect(typeof completed.durationMs).toBe('number')

  info.mockRestore()
})

const openApp = () => app({ auth: { guard: denyAllGuard, enabled: false, excludePaths: [] } })

test('answers an unknown path with the error format', async () => {
  const res = await openApp().request('/api/missing')

  expect(res.status).toBe(404)
  const body = await res.json()
  expect(body).toEqual({
    error: { code: 'not_found', message: '対象が見つかりません' },
    requestId: expect.stringMatching(/^[0-9a-f]{8}$/),
  })
})

test('marks every response, errors included, as private and not storable', async () => {
  const authenticated = app({ auth: { guard: allowAllGuard, enabled: true, excludePaths: [] } })

  expect((await authenticated.request('/api/auth/me')).headers.get('cache-control')).toBe(
    'private, no-store',
  )
  expect((await openApp().request('/api/missing')).headers.get('cache-control')).toBe(
    'private, no-store',
  )
})

test.each([
  ['a cross-site form post', { origin: 'https://evil.example', 'content-type': 'text/plain' }],
  ['a post without content type or origin', {}],
  [
    'a cross-site post claiming sec-fetch-site cross-site',
    { 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' },
  ],
])('rejects %s before authentication (CSRF)', async (_, headers: Record<string, string>) => {
  const res = await openApp().request('/api/missing', { method: 'POST', headers })

  expect(res.status).toBe(403)
  expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } })
})

test.each([
  ['a same-origin request (Sec-Fetch-Site)', { 'sec-fetch-site': 'same-origin' }],
  ['a request from this origin', { origin: 'http://localhost' }],
  ['a JSON request (needs a CORS preflight)', { 'content-type': 'application/json' }],
])('lets %s through the CSRF check', async (_, headers: Record<string, string>) => {
  const res = await openApp().request('/api/missing', { method: 'POST', headers })

  // No such route: reaching the 404 means the CSRF check passed.
  expect(res.status).toBe(404)
})

test('hides an unexpected error behind a 500 and logs it', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const failing = app({
    auth: { guard: denyAllGuard, enabled: true, excludePaths: PUBLIC_PATHS },
    authService: {
      ...fakeAuthService,
      signInWithGoogle: async () => {
        throw new Error('secret detail')
      },
    },
  })

  const res = await failing.request('/api/auth/google', sameOriginPost({ idToken: 'x' }))

  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.error).toEqual({ code: 'internal', message: 'サーバーでエラーが発生しました' })
  expect(JSON.stringify(body)).not.toContain('secret detail')
  expect(error).toHaveBeenCalledTimes(1)
  vi.restoreAllMocks()
})

const devLogin = { email: 'dev@example.com', name: '開発者' }
const openDevLogin = {
  auth: { guard: denyAllGuard, enabled: true, excludePaths: ['/api/auth/dev-login'] },
}

test('development login is off by default', async () => {
  const res = await app(openDevLogin).request('/api/auth/dev-login', sameOriginPost(devLogin))

  expect(res.status).toBe(404)
})

test('development login signs in when enabled, from localhost only', async () => {
  const enabled = app({ ...openDevLogin, devLogin: true })

  const local = await enabled.request(
    'http://localhost:8787/api/auth/dev-login',
    sameOriginPost(devLogin),
  )
  expect(await local.json()).toMatchObject({
    status: 'signed_in',
    user: { email: 'dev@example.com' },
  })
  expect(local.headers.get('set-cookie')).toMatch(/^session=dev-token;/)

  const remote = await enabled.request(
    'https://db-center.example/api/auth/dev-login',
    sameOriginPost(devLogin),
  )
  expect(remote.status).toBe(404)
})
