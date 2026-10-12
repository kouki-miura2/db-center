import { QueryClient } from '@tanstack/vue-query'
import { expect, test, vi, beforeEach } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: {
      products: {
        $post: vi.fn(),
        ':productId': {
          $get: vi.fn(),
          $patch: vi.fn(),
          $delete: vi.fn(),
          connections: {
            $post: vi.fn(),
            ':connectionId': { $patch: vi.fn(), $delete: vi.fn() },
            order: { $put: vi.fn() },
          },
        },
      },
    },
  },
}))
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { useProductMutations } from './useProductMutations.ts'
import { useProductQuery } from './useProductQuery.ts'
const product = { id: 'p1', name: '旧名', target: 'postgresql18', createdAt: 1, updatedAt: 1 }
const data = {
  product,
  role: 'owner',
  members: [],
  invitations: [],
  connections: [],
  databases: [],
}
const answer = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as never
const setup = () => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(scopeKeys.productList(), {
    revision: 1,
    data: [{ ...product, role: 'owner', joinedAt: 1 }],
  })
  client.setQueryData(scopeKeys.product('p1'), { revision: 1, data })
  const scope = effectScope()
  const mutations = scope.run(() => useProductMutations('p1', client))!
  return { client, scope, mutations }
}
beforeEach(() => vi.clearAllMocks())
test('writes rename responses into both caches without GET, preserving membership and registration dates', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(apiClient.api.products[':productId'].$patch).mockReturnValue(
    answer({
      product: { ...product, name: '新名', updatedAt: 2 },
      revisions: { products: 3, product: 2 },
    }),
  )
  await mutations.rename.mutateAsync({ name: '新名', expectedUpdatedAt: 1 })
  expect(client.getQueryData(scopeKeys.productList())).toMatchObject({
    revision: 3,
    data: [{ name: '新名', joinedAt: 1, role: 'owner' }],
  })
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 2,
    data: { product: { name: '新名' } },
  })
  expect(apiClient.api.products[':productId'].$get).not.toHaveBeenCalled()
  scope.stop()
  client.clear()
})
test('deleting a product removes descendant caches and operation history', async () => {
  const { client, scope, mutations } = setup()
  client.setQueryData(scopeKeys.product('p1'), {
    revision: 2,
    data: { ...data, databases: [{ id: 'db1' }] },
  })
  client.setQueryData(scopeKeys.database('db1'), {
    revision: 1,
    data: { versions: [{ id: 'v1' }] },
  })
  client.setQueryData(scopeKeys.version('v1'), { revision: 1, data: {} })
  client.setQueryData(['audit', 'p1'], { pages: [] })
  vi.mocked(apiClient.api.products[':productId'].$delete).mockReturnValue(
    answer({ revisions: { products: 4 } }),
  )
  await mutations.remove.mutateAsync({ confirmationName: '旧名', expectedUpdatedAt: 1 })
  expect(client.getQueryData(scopeKeys.productList())).toEqual({ revision: 4, data: [] })
  for (const key of [
    scopeKeys.product('p1'),
    scopeKeys.database('db1'),
    scopeKeys.version('v1'),
    ['audit', 'p1'],
  ])
    expect(client.getQueryData(key)).toBeUndefined()
  scope.stop()
  client.clear()
})
test('a stale rename refetches the product scope but never overwrites it with a rejected request', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(apiClient.api.products[':productId'].$get).mockReturnValue(
    answer({
      mode: 'full',
      revision: 5,
      data: { ...data, product: { ...product, name: '他のユーザー', updatedAt: 9 } },
    }),
  )
  scope.run(() => useProductQuery('p1', client))
  await vi.waitFor(() =>
    expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({ revision: 5 }),
  )
  vi.mocked(apiClient.api.products[':productId'].$patch).mockReturnValue(
    answer({ error: { code: 'stale_update', message: '再読み込みしてください' } }, 409),
  )
  await expect(
    mutations.rename.mutateAsync({ name: '自分の入力', expectedUpdatedAt: 1 }),
  ).rejects.toMatchObject({ code: 'stale_update' })
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 5,
    data: { product: { name: '他のユーザー' } },
  })
  expect(apiClient.api.products[':productId'].$get).toHaveBeenCalledTimes(2)
  scope.stop()
  client.clear()
})
