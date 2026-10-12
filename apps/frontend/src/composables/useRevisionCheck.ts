import type { QueryClient } from '@tanstack/vue-query'
import { onScopeDispose } from 'vue'

import { call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { compareRevisions, dueScopes, type ScopeQuery } from '../cache/revision-check.ts'
import type { Scope } from '../cache/scope.ts'

/**
 * When the app comes back to the front or online, checks the revisions of the scopes on screen
 * in one request, fetches the changed ones again and marks the rest as checked. Data isn't
 * fetched again unless it changed. Called once, from `App.vue`.
 */
export const useRevisionCheck = (queryClient: QueryClient) => {
  const check = async () => {
    const queries: ScopeQuery[] = queryClient
      .getQueryCache()
      .findAll({ type: 'active' })
      .filter((q) => q.state.status === 'success')
      .map((q) => ({
        queryKey: q.queryKey,
        checkedAt: q.state.dataUpdatedAt,
        revision: (q.state.data as Scope<unknown> | undefined)?.revision,
      }))
    const { due, body } = dueScopes(queries, Date.now())
    if (due.length === 0) return
    const revisions = await call(apiClient.api.revisions.check.$post({ json: body }))
    const { changed, current } = compareRevisions(due, revisions)
    for (const { queryKey } of current) {
      // Same data: only the time it was last checked moves on.
      queryClient.setQueryData(queryKey, queryClient.getQueryData(queryKey))
    }
    for (const { queryKey } of changed) {
      void queryClient.invalidateQueries({ queryKey, exact: true })
    }
  }

  // Offline or signed out: the next time the app comes back tries again.
  const run = () => void check().catch(() => {})
  const onVisible = () => {
    if (document.visibilityState === 'visible') run()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('online', run)
  onScopeDispose(() => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('online', run)
  })
}
