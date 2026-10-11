import { expect, test, vi } from 'vite-plus/test'

import { createApp } from './app.ts'
import type { AuthGuard } from './repository/auth-guard.interface.ts'
import type { SampleService } from './service/sample.service.ts'

const sampleService: SampleService = {
  getSample: async (id) => (id === '1' ? { id, message: 'Sample "First sample record"' } : null),
}
const allowAllGuard: AuthGuard = { authenticate: async () => ({ id: 'test-user' }) }
const denyAllGuard: AuthGuard = { authenticate: async () => null }

test('GET /api/sample/:id returns the service response when the auth guard is disabled', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: false, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1')

  expect(await res.json()).toEqual({ id: '1', message: 'Sample "First sample record"' })
})

test('GET /api/sample/:id returns 404 for an unknown id', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: false, excludePaths: [] },
  })

  const res = await app.request('/api/sample/missing')

  expect(res.status).toBe(404)
})

test('rejects unauthenticated requests once the auth guard is enabled', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: true, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1')

  expect(res.status).toBe(401)
})

test('allows authenticated requests once the auth guard is enabled', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: allowAllGuard, enabled: true, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1', { headers: { authorization: 'token' } })

  expect(await res.json()).toEqual({ id: '1', message: 'Sample "First sample record"' })
})

test('keeps excluded paths free access even when the auth guard is enabled', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: true, excludePaths: ['/api/sample/1'] },
  })

  const res = await app.request('/api/sample/1')

  expect(await res.json()).toEqual({ id: '1', message: 'Sample "First sample record"' })
})

test('logs a matching started/completed pair, including for a rejected request', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: true, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1')
  expect(res.status).toBe(401)

  expect(info).toHaveBeenCalledTimes(2)
  const [startedLine] = info.mock.calls[0] as [string]
  const [completedLine] = info.mock.calls[1] as [string]
  const started = JSON.parse(startedLine)
  const completed = JSON.parse(completedLine)

  expect(started).toMatchObject({
    message: 'request started',
    method: 'GET',
    path: '/api/sample/1',
  })
  expect(completed).toMatchObject({
    message: 'request completed',
    method: 'GET',
    path: '/api/sample/1',
    user: 'anonymous',
    status: 401,
  })
  expect(completed.requestId).toBe(started.requestId)
  expect(typeof completed.durationMs).toBe('number')

  info.mockRestore()
})

const openApp = () =>
  createApp({ sampleService, auth: { guard: denyAllGuard, enabled: false, excludePaths: [] } })

test('answers an unknown path with the error format', async () => {
  const res = await openApp().request('/api/missing')

  expect(res.status).toBe(404)
  const body = await res.json()
  expect(body).toEqual({
    error: { code: 'not_found', message: '対象が見つかりません' },
    requestId: expect.stringMatching(/^[0-9a-f]{8}$/),
  })
})

test('answers an unauthenticated request with the error format', async () => {
  const app = createApp({
    sampleService,
    auth: { guard: denyAllGuard, enabled: true, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1')

  expect(await res.json()).toMatchObject({ error: { code: 'unauthorized' } })
})

test('marks every response, errors included, as private and not storable', async () => {
  const app = openApp()

  expect((await app.request('/api/sample/1')).headers.get('cache-control')).toBe(
    'private, no-store',
  )
  expect((await app.request('/api/missing')).headers.get('cache-control')).toBe('private, no-store')
})

test.each([
  ['a cross-site form post', { origin: 'https://evil.example', 'content-type': 'text/plain' }],
  ['a post without content type or origin', {}],
  [
    'a cross-site post claiming sec-fetch-site cross-site',
    { 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' },
  ],
])('rejects %s before authentication (CSRF)', async (_, headers: Record<string, string>) => {
  const res = await openApp().request('/api/sample/1', { method: 'POST', headers })

  expect(res.status).toBe(403)
  expect(await res.json()).toMatchObject({ error: { code: 'forbidden' } })
})

test.each([
  ['a same-origin request (Sec-Fetch-Site)', { 'sec-fetch-site': 'same-origin' }],
  ['a request from this origin', { origin: 'http://localhost' }],
  ['a JSON request (needs a CORS preflight)', { 'content-type': 'application/json' }],
])('lets %s through the CSRF check', async (_, headers: Record<string, string>) => {
  const res = await openApp().request('/api/sample/1', { method: 'POST', headers })

  // No POST route exists: reaching the 404 means the CSRF check passed.
  expect(res.status).toBe(404)
})

test('hides an unexpected error behind a 500 and logs it', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const app = createApp({
    sampleService: {
      getSample: async () => {
        throw new Error('secret detail')
      },
    },
    auth: { guard: denyAllGuard, enabled: false, excludePaths: [] },
  })

  const res = await app.request('/api/sample/1')

  expect(res.status).toBe(500)
  const body = await res.json()
  expect(body.error).toEqual({ code: 'internal', message: 'サーバーでエラーが発生しました' })
  expect(JSON.stringify(body)).not.toContain('secret detail')
  expect(error).toHaveBeenCalledTimes(1)
  vi.restoreAllMocks()
})
