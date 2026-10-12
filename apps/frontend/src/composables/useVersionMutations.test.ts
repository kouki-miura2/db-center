import { QueryClient } from '@tanstack/vue-query'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'

vi.mock('../api/client.ts', () => ({
  LONG_REQUEST_TIMEOUT_MS: 60_000,
  withTimeout: () => ({}),
  apiClient: {
    api: {
      versions: {
        ':versionId': {
          validate: { $post: vi.fn() },
          provisional: { $post: vi.fn() },
          revert: { $post: vi.fn() },
          finalize: { $post: vi.fn() },
          'finalize-preview': { $post: vi.fn() },
        },
      },
      products: {
        ':productId': { databases: { ':databaseId': { versions: { $post: vi.fn() } } } },
      },
    },
  },
}))

import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { useVersionMutations, withVersion } from './useVersionMutations.ts'

const versions = apiClient.api.versions[':versionId']
const answer = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as never

const version = (id: string, number: number, status: string, extra = {}) =>
  ({ id, number, status, updatedAt: 1, revision: 3, memo: null, ...extra }) as never

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(scopeKeys.database('d1'), {
    revision: 5,
    data: { versions: [version('v2', 2, 'provisional'), version('v1', 1, 'final')] },
  })
  client.setQueryData(scopeKeys.version('v2'), {
    revision: 3,
    data: { version: version('v2', 2, 'provisional'), objects: [] },
  })
  const mutations = effectScope().run(() => useVersionMutations('p1', 'd1', client))
  if (!mutations) throw new Error('effectScope.run returned undefined')
  return { client, mutations }
}

beforeEach(() => {
  vi.clearAllMocks()
})

test('keeps the versions newest first with the changed one replaced or added', () => {
  const list = [version('v2', 2, 'editing'), version('v1', 1, 'final')]

  expect(withVersion(list, version('v2', 2, 'provisional')).map((v) => v)).toEqual([
    version('v2', 2, 'provisional'),
    version('v1', 1, 'final'),
  ])
  expect(withVersion(list, version('v3', 3, 'editing')).map((v: { id: string }) => v.id)).toEqual([
    'v3',
    'v2',
    'v1',
  ])
})

test('finalizing writes the final version and the next one into the caches', async () => {
  vi.mocked(versions.finalize.$post).mockReturnValue(
    answer(200, {
      version: version('v2', 2, 'final', { revision: 4 }),
      createdVersion: version('v3', 3, 'editing', { revision: 1 }),
      revisions: { version: 4, database: 6, product: 9 },
    }),
  )
  const { client, mutations } = setup()

  await mutations.finalize.mutateAsync({
    versionId: 'v2',
    expectedUpdatedAt: 1,
    expectedRevision: 3,
    memo: null,
    createNext: true,
  })

  expect(versions.finalize.$post).toHaveBeenCalledWith({
    param: { versionId: 'v2' },
    json: { expectedUpdatedAt: 1, expectedRevision: 3, memo: null, createNext: true },
  })
  const database = client.getQueryData<{ revision: number; data: { versions: { id: string }[] } }>(
    scopeKeys.database('d1'),
  )
  expect(database?.revision).toBe(6)
  expect(database?.data.versions.map((v) => v.id)).toEqual(['v3', 'v2', 'v1'])
  expect(
    client.getQueryData<{ revision: number; data: { version: { status: string } } }>(
      scopeKeys.version('v2'),
    ),
  ).toMatchObject({ revision: 4, data: { version: { status: 'final' } } })
})

test('keeps the cached revision when another write came in between', async () => {
  vi.mocked(versions.revert.$post).mockReturnValue(
    answer(200, {
      transitioned: true,
      version: version('v2', 2, 'editing', { revision: 6 }),
      revisions: { version: 6, database: 8, product: 9 },
      warning: null,
    }),
  )
  const { client, mutations } = setup()

  await mutations.revert.mutateAsync({
    versionId: 'v2',
    expectedUpdatedAt: 1,
    expectedRevision: 3,
    memo: null,
    acknowledgeApplied: false,
  })

  expect(client.getQueryData<{ revision: number }>(scopeKeys.version('v2'))?.revision).toBe(3)
  expect(client.getQueryData<{ revision: number }>(scopeKeys.database('d1'))?.revision).toBe(5)
})

test('changes nothing when going back to editing needs a confirmation', async () => {
  vi.mocked(versions.revert.$post).mockReturnValue(
    answer(200, {
      transitioned: false,
      requiresConfirmation: true,
      warning: '適用済みの接続先と設計がずれます',
      applications: [{ id: 'x', connectionName: '本番', status: 'succeeded' }],
    }),
  )
  const { client, mutations } = setup()

  const result = await mutations.revert.mutateAsync({
    versionId: 'v2',
    expectedUpdatedAt: 1,
    expectedRevision: 3,
    memo: null,
    acknowledgeApplied: false,
  })

  expect(result.transitioned).toBe(false)
  expect(
    client.getQueryData<{ data: { version: { status: string } } }>(scopeKeys.version('v2'))?.data
      .version.status,
  ).toBe('provisional')
})

test('fetches the version and database again after a stale update', async () => {
  vi.mocked(versions.provisional.$post).mockReturnValue(
    answer(409, { error: { code: 'stale_update', message: '他のユーザーが更新しました' } }),
  )
  const { client, mutations } = setup()
  const invalidate = vi.spyOn(client, 'invalidateQueries')

  await expect(
    mutations.provisional.mutateAsync({
      versionId: 'v2',
      expectedUpdatedAt: 1,
      expectedRevision: 3,
      memo: null,
    }),
  ).rejects.toMatchObject({ code: 'stale_update' })

  expect(invalidate).toHaveBeenCalledWith({ queryKey: scopeKeys.version('v2'), exact: true })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: scopeKeys.database('d1'), exact: true })
})
