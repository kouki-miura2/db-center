import { QueryClient } from '@tanstack/vue-query'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'

vi.mock('../api/client.ts', () => ({
  apiClient: { api: { auth: { me: { $get: vi.fn() } } } },
}))

import { apiClient } from '../api/client.ts'
import { useSampleQuery } from './useSampleQuery.ts'

type MeResponse = Awaited<ReturnType<typeof apiClient.api.auth.me.$get>>

const mockedGet = vi.mocked(apiClient.api.auth.me.$get)

/** Runs the composable inside its own effect scope, mirroring the lifetime it'd have in a component. */
const runSampleQuery = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const scope = effectScope()
  const query = scope.run(() => useSampleQuery(queryClient))
  if (!query) throw new Error('effectScope.run returned undefined')
  return { query, dispose: () => scope.stop() }
}

afterEach(() => {
  vi.restoreAllMocks()
})

const me = {
  user: { id: 'u1', name: 'はなこ', email: 'hanako@example.com' },
  consentRequired: false,
}

test('resolves the response from the API client', async () => {
  mockedGet.mockResolvedValue({ ok: true, json: async () => me } as unknown as MeResponse)

  const { query, dispose } = runSampleQuery()

  await vi.waitFor(() => expect(query.isSuccess.value).toBe(true))
  expect(query.data.value).toEqual(me)
  expect(mockedGet).toHaveBeenCalledTimes(1)

  dispose()
})

test('surfaces a non-ok response as an error', async () => {
  mockedGet.mockResolvedValue({ ok: false, status: 401 } as unknown as MeResponse)

  const { query, dispose } = runSampleQuery()

  await vi.waitFor(() => expect(query.isError.value).toBe(true))
  expect(query.error.value?.message).toBe('Request failed: 401')

  dispose()
})
