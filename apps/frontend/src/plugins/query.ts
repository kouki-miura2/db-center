import { QueryClient } from '@tanstack/vue-query'
import { LIMITS } from 'utils'

/** How long the cache is kept on the device: as long as a session can last. */
export const CACHE_MAX_AGE_MS = LIMITS.sessionDays * 24 * 60 * 60 * 1000

/**
 * The app's one query client ("参照 > データの取得とキャッシュ"). Data is fetched per scope and
 * kept until its revision changes, so nothing refetches by itself: a scope is checked when its
 * screen opens after `LIMITS.revisionCheckMinutes` (`staleTime`), and when the app comes back to
 * the front or online (`useRevisionCheck`), never on focus, reconnect or an interval.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Without it, the default of 3 retries with exponential backoff turns one 3s-timeout
      // request into ~20s before the error surfaces.
      retry: false,
      staleTime: LIMITS.revisionCheckMinutes * 60 * 1000,
      // Kept as long as the device cache, which only holds what's still in memory.
      gcTime: CACHE_MAX_AGE_MS,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
})
