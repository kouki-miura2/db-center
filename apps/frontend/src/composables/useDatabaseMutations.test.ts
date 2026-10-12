import { QueryClient } from '@tanstack/vue-query'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: {
      products: {
        ':productId': {
          databases: {
            $post: vi.fn(),
            ':databaseId': {
              $patch: vi.fn(),
              $delete: vi.fn(),
              'common-columns': { $put: vi.fn() },
            },
          },
        },
      },
    },
  },
}))
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { useDatabaseMutations } from './useDatabaseMutations.ts'
const database = {
  id: 'db1',
  name: 'ec_main',
  description: 'EC',
  createdAt: 1,
  updatedAt: 1,
  latestVersion: { id: 'v1', number: 1, status: 'editing' },
  latestFinalVersion: null,
  schemaCount: 1,
  tableCount: 0,
}
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as never
beforeEach(() => vi.clearAllMocks())
const setup = () => {
  const client = new QueryClient()
  client.setQueryData(scopeKeys.product('p1'), { revision: 1, data: { databases: [database] } })
  client.setQueryData(scopeKeys.database('db1'), {
    revision: 1,
    data: { database, versions: [{ id: 'v1' }], commonColumns: [], deployments: [{ id: 'd1' }] },
  })
  const scope = effectScope()
  return { client, scope, mutations: scope.run(() => useDatabaseMutations('p1', client))! }
}
test('creation passes the selected final source and exposes the new v1 without refetching the product', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(apiClient.api.products[':productId'].databases.$post).mockReturnValue(
    answer({ database: { ...database, id: 'db2', name: 'analytics' }, revisions: { product: 2 } }),
  )
  const result = await mutations.create.mutateAsync({
    name: 'analytics',
    description: '',
    sourceVersionId: 'source-v3',
  })
  expect(apiClient.api.products[':productId'].databases.$post).toHaveBeenCalledExactlyOnceWith({
    param: { productId: 'p1' },
    json: { name: 'analytics', description: '', sourceVersionId: 'source-v3' },
  })
  expect(result.latestVersion).toEqual({ id: 'v1', number: 1, status: 'editing' })
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 2,
    data: { databases: [{ name: 'analytics' }, { name: 'ec_main' }] },
  })
  scope.stop()
  client.clear()
})
test('renaming updates both scopes while preserving version counts and deployment history', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(apiClient.api.products[':productId'].databases[':databaseId'].$patch).mockReturnValue(
    answer({
      database: { id: 'db1', name: 'ec_new', description: '', createdAt: 1, updatedAt: 2 },
      revisions: { product: 3, database: 2 },
    }),
  )
  await mutations.rename.mutateAsync({
    databaseId: 'db1',
    json: { name: 'ec_new', description: '', expectedUpdatedAt: 1 },
  })
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 3,
    data: { databases: [{ name: 'ec_new', tableCount: 0, latestVersion: { id: 'v1' } }] },
  })
  expect(client.getQueryData(scopeKeys.database('db1'))).toMatchObject({
    revision: 2,
    data: { database: { name: 'ec_new' }, deployments: [{ id: 'd1' }] },
  })
  scope.stop()
  client.clear()
})
test('common column save uses the opened revision and replaces only that set', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(
    apiClient.api.products[':productId'].databases[':databaseId']['common-columns'].$put,
  ).mockReturnValue(answer({ commonColumns: [], revisions: { database: 4 } }))
  await mutations.saveCommonColumns.mutateAsync({
    databaseId: 'db1',
    json: { columns: [], expectedRevision: 1 },
  })
  expect(
    apiClient.api.products[':productId'].databases[':databaseId']['common-columns'].$put,
  ).toHaveBeenCalledExactlyOnceWith({
    param: { productId: 'p1', databaseId: 'db1' },
    json: { columns: [], expectedRevision: 1 },
  })
  expect(client.getQueryData(scopeKeys.database('db1'))).toMatchObject({
    revision: 4,
    data: { commonColumns: [], versions: [{ id: 'v1' }], deployments: [{ id: 'd1' }] },
  })
  scope.stop()
  client.clear()
})
test('deleting removes the database and its cached versions', async () => {
  const { client, scope, mutations } = setup()
  client.setQueryData(scopeKeys.version('v1'), { data: { objects: [] }, revision: 1 })
  vi.mocked(apiClient.api.products[':productId'].databases[':databaseId'].$delete).mockReturnValue(
    answer({ revisions: { product: 2 } }),
  )
  await mutations.remove.mutateAsync({
    databaseId: 'db1',
    json: { confirmationName: 'ec_main', expectedUpdatedAt: 1 },
  })
  expect(client.getQueryData(scopeKeys.product('p1'))).toEqual({
    revision: 2,
    data: { databases: [] },
  })
  expect(client.getQueryData(scopeKeys.database('db1'))).toBeUndefined()
  expect(client.getQueryData(scopeKeys.version('v1'))).toBeUndefined()
  scope.stop()
  client.clear()
})
