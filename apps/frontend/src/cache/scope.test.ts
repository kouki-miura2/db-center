import { expect, test, vi } from 'vite-plus/test'

import { fetchScope, type Scope } from './scope.ts'

test('fetches the whole scope without a cache', async () => {
  const fetch = vi.fn().mockResolvedValue({ mode: 'full', revision: 3, data: ['a'] })

  expect(await fetchScope(undefined, fetch)).toEqual({ revision: 3, data: ['a'] })
  expect(fetch).toHaveBeenCalledWith(undefined)
})

test('keeps the cached object when the scope is unchanged', async () => {
  const cached: Scope<string[]> = { revision: 3, data: ['a'] }
  const fetch = vi.fn().mockResolvedValue({ mode: 'unchanged', revision: 3 })

  expect(await fetchScope(cached, fetch)).toBe(cached)
  expect(fetch).toHaveBeenCalledWith(3)
})

test('replaces the cache when the scope changed', async () => {
  const fetch = vi.fn().mockResolvedValue({ mode: 'full', revision: 4, data: ['a', 'b'] })

  expect(await fetchScope({ revision: 3, data: ['a'] }, fetch)).toEqual({
    revision: 4,
    data: ['a', 'b'],
  })
})
