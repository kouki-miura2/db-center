import { type QueryClient, useQuery, useQueryClient } from '@tanstack/vue-query'

import { call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { fetchScope, type Scope, scopeKeys } from '../cache/scope.ts'

type ProductListResult = Awaited<ReturnType<typeof fetchProductList>>

const fetchProductList = (revision: number | undefined) =>
  call(
    apiClient.api.products.$get({
      query: revision === undefined ? {} : { revision: String(revision) },
    }),
  )

export type ProductListItem = Extract<ProductListResult, { mode: 'full' }>['data'][number]

/**
 * The product list scope: every product the user takes part in, by name. `queryClient` is only
 * needed in tests, to run the query outside of a mounted app.
 */
export const useProductListQuery = (queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const queryKey = scopeKeys.productList()
  return useQuery(
    {
      queryKey,
      queryFn: () =>
        fetchScope(client.getQueryData<Scope<ProductListItem[]>>(queryKey), fetchProductList),
    },
    client,
  )
}
