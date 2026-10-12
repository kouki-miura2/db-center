import { QueryClient } from '@tanstack/vue-query'
import { expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: { products: { ':productId': { databases: { ':databaseId': { $get: vi.fn() } } } } },
  },
}))
import { apiClient } from '../api/client.ts'
import { useDatabaseQuery } from './useDatabaseQuery.ts'
const get = apiClient.api.products[':productId'].databases[':databaseId'].$get
const answer = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as never
test('sends revision, preserves unchanged data, and merges execution deltas without losing older history', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const first = {
    database: { id: 'db1', name: 'ec_main' },
    commonColumns: [],
    versions: [],
    deployments: [
      { id: 'd1', startedAt: 1, status: 'running' },
      { id: 'd2', startedAt: 2, status: 'succeeded' },
    ],
  }
  vi.mocked(get)
    .mockReturnValueOnce(answer({ mode: 'full', revision: 1, data: first }))
    .mockReturnValueOnce(answer({ mode: 'unchanged', revision: 1 }))
    .mockReturnValueOnce(
      answer({
        mode: 'delta',
        revision: 3,
        data: {
          ...first,
          database: { id: 'db1', name: 'ec_changed' },
          deployments: [
            { id: 'd1', startedAt: 1, status: 'failed' },
            { id: 'd3', startedAt: 3, status: 'running' },
          ],
        },
      }),
    )
  const scope = effectScope()
  const query = scope.run(() => useDatabaseQuery('p1', 'db1', client))!
  await vi.waitFor(() => expect(query.isSuccess.value).toBe(true))
  const cached = query.data.value
  await query.refetch()
  expect(query.data.value).toBe(cached)
  expect(get).toHaveBeenLastCalledWith({
    param: { productId: 'p1', databaseId: 'db1' },
    query: { revision: '1' },
  })
  await query.refetch()
  expect(query.data.value?.data.database.name).toBe('ec_changed')
  expect(query.data.value?.data.deployments.map((row) => [row.id, row.status])).toEqual([
    ['d3', 'running'],
    ['d2', 'succeeded'],
    ['d1', 'failed'],
  ])
  expect(query.data.value?.revision).toBe(3)
  // An excluded participant must not see previously cached details after a 404.
  vi.mocked(get).mockReturnValueOnce(
    answer({ error: { code: 'not_found', message: '対象が見つかりません' } }, 404),
  )
  await query.refetch()
  expect(query.data.value).toBeUndefined()
  scope.stop()
  client.clear()
})
