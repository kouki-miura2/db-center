import { type QueryClient, useQuery, useQueryClient } from '@tanstack/vue-query'
import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import { ApiError, call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { fetchScope, type Scope, scopeKeys } from '../cache/scope.ts'

const fetchProduct = (productId: string, revision?: number) =>
  call(
    apiClient.api.products[':productId'].$get({
      param: { productId },
      query: revision === undefined ? {} : { revision: String(revision) },
    }),
  )

export type ProductData = Extract<
  Awaited<ReturnType<typeof fetchProduct>>,
  { mode: 'full' }
>['data']
export type Connection = ProductData['connections'][number]
export type Member = ProductData['members'][number]

export const useProductQuery = (productId: MaybeRefOrGetter<string>, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const query = useQuery(
    {
      enabled: computed(() => !!toValue(productId)),
      queryKey: computed(() => scopeKeys.product(toValue(productId))),
      queryFn: () => {
        const id = toValue(productId)
        return fetchScope(
          client.getQueryData<Scope<ProductData>>(scopeKeys.product(id)),
          (revision) => fetchProduct(id, revision),
        )
      },
    },
    client,
  )
  // A cached scope may still exist after the user was excluded or its parent was deleted.
  // Once the API denies access, do not render that cached data.
  const data = computed(() =>
    query.error.value instanceof ApiError &&
    ['not_found', 'forbidden', 'unauthorized'].includes(query.error.value.code)
      ? undefined
      : query.data.value,
  )
  return { ...query, data }
}
