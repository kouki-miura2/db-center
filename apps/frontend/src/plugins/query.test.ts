import { expect, test, vi } from 'vite-plus/test'

import { CACHE_MAX_AGE_MS, queryClient } from './query.ts'

test('keeps the cache no longer than a timer can wait', () => {
  expect(CACHE_MAX_AGE_MS).toBeLessThanOrEqual(2 ** 31 - 1)
  expect(queryClient.getDefaultOptions().queries?.gcTime).toBe(CACHE_MAX_AGE_MS)
})

test('keeps an unused query instead of dropping it at once', () => {
  vi.useFakeTimers()
  try {
    queryClient.setQueryData(['products'], { revision: 1, data: [] })
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(queryClient.getQueryData(['products'])).toEqual({ revision: 1, data: [] })
  } finally {
    queryClient.clear()
    vi.useRealTimers()
  }
})
