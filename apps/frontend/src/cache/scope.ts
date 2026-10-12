// Cacheable scopes ("参照 > データの取得とキャッシュ"): the client sends the revision it has, and
// the API answers "unchanged" (reading only the revision row) or the whole scope. Scopes fetched
// as a delta (a version's objects, a database's deployments) merge on top of this in their own
// query.

/** What the query cache holds for a scope: its data and the revision it's at. */
export interface Scope<T> {
  revision: number
  data: T
}

export type ScopeResult<T> =
  | { mode: 'unchanged'; revision: number }
  | { mode: 'full'; revision: number; data: T }

/**
 * Fetches a scope, sending the cached revision: an unchanged scope keeps the cached object (so
 * nothing re-renders), a changed one is replaced. Without a cache it fetches the whole scope.
 */
export const fetchScope = async <T>(
  cached: Scope<T> | undefined,
  fetch: (revision: number | undefined) => Promise<ScopeResult<T>>,
): Promise<Scope<T>> => {
  const result = await fetch(cached?.revision)
  if (result.mode === 'full') return { revision: result.revision, data: result.data }
  // "Unchanged" without a cache can't happen (no revision was sent); fetch it whole just in case.
  return cached ?? fetchScope(undefined, fetch)
}

/** The query keys of the cacheable scopes, which the revision check recognizes. */
export const scopeKeys = {
  productList: () => ['products'] as const,
  product: (productId: string) => ['product', productId] as const,
  database: (databaseId: string) => ['database', databaseId] as const,
  version: (versionId: string) => ['version', versionId] as const,
}
