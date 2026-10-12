import { type QueryClient, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import { ApiError, call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { type Scope, scopeKeys } from '../cache/scope.ts'

const fetchDatabase = (productId: string, databaseId: string, revision?: number) =>
  call(
    apiClient.api.products[':productId'].databases[':databaseId'].$get({
      param: { productId, databaseId },
      query: revision === undefined ? {} : { revision: String(revision) },
    }),
  )
export type DatabaseData = Extract<
  Awaited<ReturnType<typeof fetchDatabase>>,
  { mode: 'full' | 'delta' }
>['data']
export type CommonColumn = DatabaseData['commonColumns'][number]

/** Other database fields arrive whole; deployments are a delta keyed by execution ID. */
export const mergeDatabase = (cached: DatabaseData, next: DatabaseData): DatabaseData => {
  const deployments = new Map(cached.deployments.map((row) => [row.id, row]))
  next.deployments.forEach((row) => deployments.set(row.id, row))
  return {
    ...next,
    deployments: [...deployments.values()].toSorted(
      (a, b) => b.startedAt - a.startedAt || a.id.localeCompare(b.id),
    ),
  }
}
export const useDatabaseQuery = (
  productId: string,
  databaseId: MaybeRefOrGetter<string>,
  queryClient?: QueryClient,
) => {
  const client = queryClient ?? useQueryClient()
  const query = useQuery(
    {
      queryKey: computed(() => scopeKeys.database(toValue(databaseId))),
      enabled: computed(() => !!toValue(databaseId)),
      queryFn: async () => {
        const id = toValue(databaseId)
        const cached = client.getQueryData<Scope<DatabaseData>>(scopeKeys.database(id))
        let result = await fetchDatabase(productId, id, cached?.revision)
        if (result.mode === 'unchanged' && cached) return cached
        if (result.mode === 'unchanged') result = await fetchDatabase(productId, id)
        if (result.mode === 'unchanged')
          throw new ApiError('invalid_state', 'データを取得できませんでした')
        return {
          revision: result.revision,
          data:
            result.mode === 'delta' && cached
              ? mergeDatabase(cached.data, result.data)
              : result.data,
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
