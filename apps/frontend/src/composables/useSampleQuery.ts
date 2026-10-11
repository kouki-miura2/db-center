import type { QueryClient } from '@tanstack/vue-query'
import { useQuery } from '@tanstack/vue-query'

import { apiClient } from '../api/client.ts'

/**
 * Reference query: the signed-in user (`GET /api/auth/me`). `queryClient` is only needed in
 * tests, to run the query outside of a mounted app.
 */
export const useSampleQuery = (queryClient?: QueryClient) =>
  useQuery(
    {
      queryKey: ['auth', 'me'],
      queryFn: async () => {
        const res = await apiClient.api.auth.me.$get()
        if (!res.ok) throw new Error(`Request failed: ${res.status}`)
        return res.json()
      },
      staleTime: 10_000,
    },
    queryClient,
  )
