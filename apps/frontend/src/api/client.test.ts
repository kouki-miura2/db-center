import { afterEach, expect, test, vi } from 'vite-plus/test'

import { apiClient, withTimeout } from './client.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

const sentInit = (fetchSpy: ReturnType<typeof vi.spyOn>) =>
  (fetchSpy.mock.calls[0] as [RequestInfo, RequestInit])[1]

test('exposes a typed RPC method for each backend route', () => {
  expect(apiClient.api.auth.me.$get).toBeTypeOf('function')
})

test('sends requests with an abort signal so they time out', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))

  await apiClient.api.auth.me.$get()

  expect(fetchSpy).toHaveBeenCalledTimes(1)
  expect(sentInit(fetchSpy).signal).toBeInstanceOf(AbortSignal)
})

test('keeps the signal of a call that sets its own timeout', async () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'))
  const options = withTimeout(60_000)

  await apiClient.api.auth.me.$get(undefined, options)

  expect(sentInit(fetchSpy).signal).toBe(options.init.signal)
})
