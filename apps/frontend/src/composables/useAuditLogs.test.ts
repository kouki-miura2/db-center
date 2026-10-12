import { QueryClient } from '@tanstack/vue-query'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: { api: { products: { ':productId': { 'audit-logs': { $get: vi.fn() } } } } },
}))
import { apiClient } from '../api/client.ts'
import { useAuditLogs, type AuditPage } from './useAuditLogs.ts'
const get = apiClient.api.products[':productId']['audit-logs'].$get
const entry = (id: string) => ({
  id,
  cursor: `${id}_cursor`,
  createdAt: 1,
  userId: 'u1',
  userName: '山田',
  targetType: 'product' as const,
  action: 'create',
  summary: 'EC',
})
const answer = (page: AuditPage) => ({ ok: true, status: 200, json: async () => page }) as never
beforeEach(() => vi.clearAllMocks())
test('reopening fetches only rows after the newest cursor, preserving older pages and de-duplicating', async () => {
  const client = new QueryClient()
  client.setQueryData(['audit', 'p1'], {
    pages: [
      { entries: [entry('2')], nextBefore: '2_cursor', truncated: false },
      { entries: [entry('1')], nextBefore: null, truncated: false },
    ],
    pageParams: [undefined, '2_cursor'],
  })
  vi.mocked(get).mockReturnValue(
    answer({ entries: [entry('3'), entry('2')], nextBefore: null, truncated: false }),
  )
  const scope = effectScope()
  const logs = scope.run(() => useAuditLogs('p1', client))!
  await logs.refresh.mutateAsync()
  expect(get).toHaveBeenCalledExactlyOnceWith({
    param: { productId: 'p1' },
    query: { after: '2_cursor' },
  })
  expect(logs.query.data.value?.pages.flatMap((page) => page.entries.map((row) => row.id))).toEqual(
    ['3', '2', '1'],
  )
  scope.stop()
  client.clear()
})
test('too many new rows replaces the old paging boundaries with a fresh top page', async () => {
  const client = new QueryClient()
  client.setQueryData(['audit', 'p1'], {
    pages: [{ entries: [entry('1')], nextBefore: null, truncated: false }],
    pageParams: [undefined],
  })
  vi.mocked(get)
    .mockReturnValueOnce(answer({ entries: [entry('3')], nextBefore: null, truncated: true }))
    .mockReturnValueOnce(
      answer({ entries: [entry('3'), entry('2')], nextBefore: '2_cursor', truncated: false }),
    )
  const scope = effectScope()
  const logs = scope.run(() => useAuditLogs('p1', client))!
  await logs.refresh.mutateAsync()
  expect(get).toHaveBeenLastCalledWith({ param: { productId: 'p1' }, query: {} })
  expect(logs.query.data.value?.pageParams).toEqual([undefined])
  expect(logs.query.hasNextPage.value).toBe(true)
  scope.stop()
  client.clear()
})
