import { QueryClient } from '@tanstack/vue-query'
import { afterEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'

vi.mock('../api/client.ts', () => ({
  apiClient: { api: { products: { $get: vi.fn() } } },
}))

import { apiClient } from '../api/client.ts'
import { useProductListQuery } from './useProductListQuery.ts'

const product = {
  id: 'p1',
  name: 'EC基幹システム',
  target: 'postgresql18',
  role: 'owner',
  createdAt: 1,
  joinedAt: 1,
  updatedAt: 1,
}

const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as never

afterEach(() => {
  vi.clearAllMocks()
})

test('fetches the whole list first, then sends the cached revision', async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.mocked(apiClient.api.products.$get)
    .mockReturnValueOnce(answer({ mode: 'full', revision: 5, data: [product] }))
    .mockReturnValueOnce(answer({ mode: 'unchanged', revision: 5 }))
  const scope = effectScope()
  const query = scope.run(() => useProductListQuery(queryClient))
  if (!query) throw new Error('effectScope.run returned undefined')

  await vi.waitFor(() => expect(query.isSuccess.value).toBe(true))
  expect(apiClient.api.products.$get).toHaveBeenLastCalledWith({ query: {} })
  const first = query.data.value

  await query.refetch()
  expect(apiClient.api.products.$get).toHaveBeenLastCalledWith({ query: { revision: '5' } })
  expect(query.data.value).toBe(first)
  expect(query.data.value?.data).toEqual([product])

  scope.stop()
})
