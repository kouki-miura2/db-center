import {
  type InfiniteData,
  type QueryClient,
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from '@tanstack/vue-query'

import { call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'

const fetchPage = (productId: string, query: { before?: string; after?: string }) =>
  call(apiClient.api.products[':productId']['audit-logs'].$get({ param: { productId }, query }))
export type AuditPage = Awaited<ReturnType<typeof fetchPage>>

export const prependAudit = (
  cached: InfiniteData<AuditPage, string | undefined>,
  added: AuditPage,
): InfiniteData<AuditPage, string | undefined> => {
  if (added.truncated) throw new Error('A truncated page must be fetched from the top')
  const seen = new Set(added.entries.map((entry) => entry.id))
  return {
    ...cached,
    pages: cached.pages.map((page, index) => ({
      ...page,
      entries: [
        ...(index === 0 ? added.entries : []),
        ...page.entries.filter((entry) => !seen.has(entry.id)),
      ],
    })),
  }
}
export const useAuditLogs = (productId: string, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const queryKey = ['audit', productId]
  const query = useInfiniteQuery(
    {
      queryKey,
      initialPageParam: undefined as string | undefined,
      queryFn: ({ pageParam }) => fetchPage(productId, pageParam ? { before: pageParam } : {}),
      getNextPageParam: (page) => page.nextBefore ?? undefined,
      refetchOnMount: false,
    },
    client,
  )
  const refresh = useMutation(
    {
      mutationFn: async () => {
        const cached = client.getQueryData<InfiniteData<AuditPage, string | undefined>>(queryKey)
        const after = cached?.pages[0]?.entries[0]?.cursor
        if (!cached || !after) {
          await query.refetch()
          return
        }
        const added = await fetchPage(productId, { after })
        if (added.truncated) {
          const page = await fetchPage(productId, {})
          client.setQueryData(queryKey, { pages: [page], pageParams: [undefined] })
        } else client.setQueryData(queryKey, prependAudit(cached, added))
      },
    },
    client,
  )
  return { query, refresh }
}
