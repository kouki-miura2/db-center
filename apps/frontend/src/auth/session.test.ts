import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { createMemoryHistory, createRouter } from 'vue-router'

vi.mock('../api/client.ts', () => ({
  apiClient: { api: { auth: { me: { $get: vi.fn() }, logout: { $post: vi.fn() } } } },
}))
vi.mock('idb-keyval', () => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() }))
vi.mock('../cache/persist.ts', () => ({
  startPersisting: vi.fn(),
  removePersisted: vi.fn(),
}))

import { del, get, set } from 'idb-keyval'

import { ApiError } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { removePersisted, startPersisting } from '../cache/persist.ts'
import { queryClient } from '../plugins/query.ts'
import { useAuthStore } from '../stores/auth.ts'
import { endSession, listenForAuthErrors, loadSession, signOut } from './session.ts'

const user = { id: 'u1', name: '山田 太郎', email: 'taro@example.com' }
const stop = vi.fn()

const answer = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as never

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  queryClient.clear()
  vi.mocked(startPersisting).mockResolvedValue(stop)
  vi.mocked(get).mockResolvedValue(undefined)
  vi.mocked(set).mockResolvedValue(undefined)
  vi.mocked(del).mockResolvedValue(undefined)
})

test('starts the session of a signed-in user with their cache', async () => {
  vi.mocked(apiClient.api.auth.me.$get).mockReturnValue(
    answer(200, { user, consentRequired: true }),
  )

  await loadSession()

  const auth = useAuthStore()
  expect(auth.status).toBe('signedIn')
  expect(auth.user).toEqual(user)
  expect(auth.consentRequired).toBe(true)
  expect(startPersisting).toHaveBeenCalledWith(queryClient, 'u1')
  expect(set).toHaveBeenCalledWith('session-user', user)
})

test('is signed out when the API says so', async () => {
  vi.mocked(apiClient.api.auth.me.$get).mockReturnValue(
    answer(401, { error: { code: 'unauthorized', message: 'ログインしてください' } }),
  )

  await loadSession()

  expect(useAuthStore().status).toBe('signedOut')
  expect(get).not.toHaveBeenCalled()
})

test('carries on offline as the last signed-in user', async () => {
  vi.mocked(apiClient.api.auth.me.$get).mockRejectedValue(new TypeError('Failed to fetch'))
  vi.mocked(get).mockResolvedValue(user)

  await loadSession()

  expect(useAuthStore().user).toEqual(user)
  expect(startPersisting).toHaveBeenCalledWith(queryClient, 'u1')
})

test('is signed out offline when nobody signed in on the device', async () => {
  vi.mocked(apiClient.api.auth.me.$get).mockRejectedValue(new TypeError('Failed to fetch'))
  vi.mocked(get).mockResolvedValue(undefined)

  await loadSession()

  expect(useAuthStore().status).toBe('signedOut')
})

test('ending the session deletes the user data from the device', async () => {
  vi.mocked(apiClient.api.auth.me.$get).mockReturnValue(
    answer(200, { user, consentRequired: false }),
  )
  await loadSession()
  queryClient.setQueryData(['products'], { revision: 1, data: [] })

  await endSession()

  expect(stop).toHaveBeenCalled()
  expect(queryClient.getQueryData(['products'])).toBeUndefined()
  expect(removePersisted).toHaveBeenCalledWith('u1')
  expect(useAuthStore().status).toBe('signedOut')
})

test('signing out ends the session even if the request fails', async () => {
  vi.mocked(apiClient.api.auth.logout.$post).mockRejectedValue(new TypeError('Failed to fetch'))

  await signOut()

  expect(useAuthStore().status).toBe('signedOut')
})

test('sends the person to sign in when a query finds the session expired', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/login', name: 'login', component: {} },
      { path: '/consent', name: 'consent', component: {} },
    ],
  })
  const push = vi.spyOn(router, 'push').mockResolvedValue(undefined)
  listenForAuthErrors(queryClient, router)

  await queryClient
    .fetchQuery({
      queryKey: ['products'],
      queryFn: () => Promise.reject(new ApiError('unauthorized', 'ログインしてください')),
    })
    .catch(() => {})
  expect(push).toHaveBeenCalledWith(expect.objectContaining({ name: 'login' }))

  await queryClient
    .fetchQuery({
      queryKey: ['product', 'p1'],
      queryFn: () => Promise.reject(new ApiError('consent_required', '同意が必要です')),
    })
    .catch(() => {})
  expect(push).toHaveBeenCalledWith({ name: 'consent' })
  expect(useAuthStore().consentRequired).toBe(true)
})
