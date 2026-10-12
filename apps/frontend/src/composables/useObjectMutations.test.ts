import { QueryClient } from '@tanstack/vue-query'
import { expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: {
      versions: {
        ':versionId': {
          objects: { $post: vi.fn(), ':objectKey': { $put: vi.fn(), $delete: vi.fn() } },
        },
      },
    },
  },
  withTimeout: () => ({}),
  LONG_REQUEST_TIMEOUT_MS: 60000,
}))
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { newObject } from '../design/object.ts'
import { useObjectMutations } from './useObjectMutations.ts'
const api = apiClient.api.versions[':versionId'].objects
const answer = (body: unknown, status = 200) =>
  ({ ok: status < 300, status, json: async () => body }) as never
test('save sends the displayed optimistic lock and merges returned data without fetching; a revision gap remains eligible for delta', async () => {
  const client = new QueryClient()
  const old = { objectKey: 'other', name: 'other', deletedAt: null }
  const object = { objectKey: 'current', name: 'orders', deletedAt: null, updatedAt: 2 }
  client.setQueryData(scopeKeys.version('v'), {
    revision: 2,
    data: { version: { id: 'v', revision: 2 }, objects: [old] },
  })
  const scope = effectScope(),
    mutations = scope.run(() => useObjectMutations('p', 'd', client))!
  vi.mocked(api[':objectKey'].$put).mockReturnValueOnce(
    answer({
      object,
      version: { id: 'v', revision: 3, tableCount: 2 },
      revisions: { version: 3, database: 4, product: 5 },
    }),
  )
  const input = newObject('table', null, 'sqlite3')
  await mutations.save.mutateAsync({
    versionId: 'v',
    objectKey: 'current',
    expectedUpdatedAt: 1,
    input,
  })
  expect(api[':objectKey'].$put).toHaveBeenLastCalledWith(
    { param: { versionId: 'v', objectKey: 'current' }, json: { input, expectedUpdatedAt: 1 } },
    {},
  )
  expect(client.getQueryData(scopeKeys.version('v'))).toMatchObject({
    revision: 3,
    data: { objects: [old, object], version: { tableCount: 2 } },
  })
  vi.mocked(api.$post).mockReturnValueOnce(
    answer({
      object: { ...object, objectKey: 'new' },
      version: { id: 'v', revision: 5 },
      revisions: { version: 5, database: 6, product: 7 },
    }),
  )
  await mutations.save.mutateAsync({ versionId: 'v', objectKey: 'new', input })
  expect(api.$post).toHaveBeenLastCalledWith(
    { param: { versionId: 'v' }, json: { ...input, objectKey: 'new' } },
    {},
  )
  expect(client.getQueryData(scopeKeys.version('v'))).toMatchObject({
    revision: 3,
    data: { version: { revision: 5 } },
  })
  scope.stop()
  client.clear()
})
test('delete removes the cached object; a conflict immediately invalidates the visible scopes', async () => {
  const client = new QueryClient(),
    scope = effectScope(),
    mutations = scope.run(() => useObjectMutations('p', 'd', client))!
  client.setQueryData(scopeKeys.version('v'), {
    revision: 1,
    data: {
      version: { id: 'v' },
      objects: [
        { objectKey: 'a', deletedAt: null },
        { objectKey: 'b', deletedAt: null },
      ],
    },
  })
  vi.mocked(api[':objectKey'].$delete).mockReturnValueOnce(
    answer({
      object: { objectKey: 'a', deletedAt: 2 },
      version: { id: 'v', revision: 2 },
      revisions: { version: 2, database: 2, product: 2 },
    }),
  )
  await mutations.remove.mutateAsync({
    versionId: 'v',
    objectKey: 'a',
    expectedUpdatedAt: 1,
    confirmationName: 'a',
  })
  expect(client.getQueryData(scopeKeys.version('v'))).toMatchObject({
    revision: 2,
    data: { objects: [{ objectKey: 'b' }] },
  })
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  vi.mocked(api[':objectKey'].$put).mockReturnValueOnce(
    answer({ error: { code: 'stale_update', message: '他のユーザーが更新しました' } }, 409),
  )
  await expect(
    mutations.save.mutateAsync({
      versionId: 'v',
      objectKey: 'b',
      expectedUpdatedAt: 1,
      input: newObject('table', null, 'sqlite3'),
    }),
  ).rejects.toMatchObject({ code: 'stale_update' })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: scopeKeys.version('v'), exact: true })
  expect(invalidate).toHaveBeenCalledWith({ queryKey: scopeKeys.database('d'), exact: true })
  scope.stop()
  client.clear()
})
