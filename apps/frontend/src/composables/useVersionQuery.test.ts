import { QueryClient } from '@tanstack/vue-query'
import { expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: { api: { versions: { ':versionId': { $get: vi.fn() } } } },
}))
import { apiClient } from '../api/client.ts'
import { useVersionQuery } from './useVersionQuery.ts'
const get = apiClient.api.versions[':versionId'].$get
const answer = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as never
test('unchanged preserves cache; deltas merge by stable key and remove tombstones; full replaces compacted scope', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const row = (key: string, name = key) => ({ objectKey: key, name, deletedAt: null })
  const version = { id: 'v1', revision: 1 }
  vi.mocked(get)
    .mockReturnValueOnce(
      answer({ mode: 'full', revision: 1, data: { version, objects: [row('a'), row('b')] } }),
    )
    .mockReturnValueOnce(answer({ mode: 'unchanged', revision: 1 }))
    .mockReturnValueOnce(
      answer({
        mode: 'delta',
        revision: 4,
        version: { ...version, revision: 4 },
        upserted: [row('a', 'renamed'), row('c')],
        deletedKeys: ['b'],
      }),
    )
    .mockReturnValueOnce(
      answer({ mode: 'full', revision: 5, data: { version, objects: [row('c')] } }),
    )
  const scope = effectScope(),
    query = scope.run(() => useVersionQuery('v1', client))!
  await vi.waitFor(() => expect(query.isSuccess.value).toBe(true))
  const first = query.data.value
  await query.refetch()
  expect(query.data.value).toBe(first)
  await query.refetch()
  expect(query.data.value?.data.objects.map((r) => [r.objectKey, r.name])).toEqual([
    ['a', 'renamed'],
    ['c', 'c'],
  ])
  expect(query.data.value?.revision).toBe(4)
  await query.refetch()
  expect(query.data.value?.data.objects.map((r) => r.objectKey)).toEqual(['c'])
  expect(get).toHaveBeenLastCalledWith({ param: { versionId: 'v1' }, query: { revision: '4' } })
  vi.mocked(get).mockReturnValueOnce(
    answer({ error: { code: 'not_found', message: '対象が見つかりません' } }, 404),
  )
  await query.refetch()
  expect(query.data.value).toBeUndefined()
  scope.stop()
  client.clear()
})
