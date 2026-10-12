import { type QueryClient, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import { ApiError, call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { type Scope, scopeKeys } from '../cache/scope.ts'

const fetchVersion = (versionId: string, revision?: number) =>
  call(
    apiClient.api.versions[':versionId'].$get({
      param: { versionId },
      query: revision === undefined ? {} : { revision: String(revision) },
    }),
  )
export type VersionData = Extract<
  Awaited<ReturnType<typeof fetchVersion>>,
  { mode: 'full' }
>['data']
export type ObjectRecord = VersionData['objects'][number]
export const mergeObjects = (
  old: ObjectRecord[],
  upserted: ObjectRecord[],
  deletedKeys: string[],
) => {
  const map = new Map(old.map((row) => [row.objectKey, row]))
  upserted.forEach((row) => map.set(row.objectKey, row))
  deletedKeys.forEach((key) => map.delete(key))
  return [...map.values()].filter((row) => row.deletedAt === null)
}
export const useVersionQuery = (versionId: MaybeRefOrGetter<string>, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const query = useQuery(
    {
      queryKey: computed(() => scopeKeys.version(toValue(versionId))),
      enabled: computed(() => !!toValue(versionId)),
      queryFn: async (): Promise<Scope<VersionData>> => {
        const id = toValue(versionId)
        const cached = client.getQueryData<Scope<VersionData>>(scopeKeys.version(id))
        let result = await fetchVersion(id, cached?.revision)
        if (result.mode === 'unchanged' && cached) return cached
        if (result.mode === 'unchanged' || (result.mode === 'delta' && !cached))
          result = await fetchVersion(id)
        if (result.mode === 'unchanged')
          throw new ApiError('invalid_state', 'データを取得できませんでした')
        return {
          revision: result.revision,
          data:
            result.mode === 'full'
              ? {
                  ...result.data,
                  objects: result.data.objects.filter((row) => row.deletedAt === null),
                }
              : {
                  version: result.version,
                  objects: mergeObjects(
                    cached?.data.objects ?? [],
                    result.upserted,
                    result.deletedKeys,
                  ),
                },
        }
      },
    },
    client,
  )
  const data = computed(() =>
    query.error.value instanceof ApiError &&
    ['not_found', 'forbidden', 'unauthorized'].includes(query.error.value.code)
      ? undefined
      : query.data.value,
  )
  return { ...query, data }
}
