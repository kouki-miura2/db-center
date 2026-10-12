import type { QueryClient, QueryKey } from '@tanstack/vue-query'

import type { ProductListItem } from '../composables/useProductListQuery.ts'
import type { ProductData } from '../composables/useProductQuery.ts'
import { type Scope, scopeKeys } from './scope.ts'

// Only an existing full scope can be advanced by a partial mutation response.
export const updateScope = <T>(
  client: QueryClient,
  key: QueryKey,
  revision: number,
  change: (data: T) => T,
) =>
  client.setQueryData<Scope<T>>(key, (old) =>
    old ? { revision, data: change(old.data) } : undefined,
  )

export const updateProduct = (
  client: QueryClient,
  id: string,
  revision: number,
  change: (data: ProductData) => ProductData,
) => updateScope(client, scopeKeys.product(id), revision, change)

export const updateProductList = (
  client: QueryClient,
  revision: number,
  change: (data: ProductListItem[]) => ProductListItem[],
) =>
  updateScope(client, scopeKeys.productList(), revision, (data: ProductListItem[]) =>
    change(data).toSorted((a, b) => a.name.localeCompare(b.name, 'ja')),
  )

/** Delete the inaccessible product and its cached descendants, including operation history. */
export const removeProductCache = (client: QueryClient, id: string) => {
  const data = client.getQueryData<Scope<ProductData>>(scopeKeys.product(id))?.data
  for (const database of data?.databases ?? []) {
    const versions =
      client.getQueryData<Scope<{ versions: { id: string }[] }>>(scopeKeys.database(database.id))
        ?.data.versions ?? []
    for (const version of versions)
      client.removeQueries({ queryKey: scopeKeys.version(version.id) })
    client.removeQueries({ queryKey: scopeKeys.database(database.id) })
  }
  client.removeQueries({ queryKey: scopeKeys.product(id) })
  client.removeQueries({ queryKey: ['audit', id] })
}

/**
 * The revision to store after a write that returned `returned`: that one only if no other write
 * came in between (cached + 1). Otherwise the cached one stays, so the next check fetches what
 * this response doesn't contain.
 */
export const revisionAfterWrite = (client: QueryClient, key: QueryKey, returned: number) => {
  const cached = client.getQueryData<{ revision: number }>(key)?.revision ?? 0
  return returned === cached + 1 ? returned : cached
}
