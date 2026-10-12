import {
  persistQueryClient,
  type PersistedClient,
  type Persister,
} from '@tanstack/query-persist-client-core'
import type { QueryClient } from '@tanstack/vue-query'
import { del, get, set } from 'idb-keyval'

import { CACHE_MAX_AGE_MS } from '../plugins/query.ts'

// The query cache on the device, one IndexedDB entry per user ("参照 > データの取得とキャッシュ >
// キャッシュ"), so the last data shows at once when the app opens, and offline.

/** Raise when the shape of cached data changes, so an old cache is dropped instead of misread. */
const CACHE_BUSTER = '1'

const cacheKey = (userId: string) => `query-cache:${userId}`

const idbPersister = (userId: string): Persister => ({
  persistClient: (client) => set(cacheKey(userId), client),
  restoreClient: () => get<PersistedClient>(cacheKey(userId)),
  removeClient: () => del(cacheKey(userId)),
})

/**
 * Restores the user's cache into `queryClient` and saves every later change. Resolves once
 * restored; returns the function that stops saving.
 */
export const startPersisting = async (queryClient: QueryClient, userId: string) => {
  const [stop, restored] = persistQueryClient({
    queryClient,
    persister: idbPersister(userId),
    maxAge: CACHE_MAX_AGE_MS,
    buster: CACHE_BUSTER,
  })
  // A broken or unavailable IndexedDB (private browsing) only means there's no cache.
  await restored.catch(() => {})
  return stop
}

/** Deletes the user's cache from the device (signing out, withdrawal). */
export const removePersisted = (userId: string) => del(cacheKey(userId)).catch(() => {})
