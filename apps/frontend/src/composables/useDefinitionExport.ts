import { type QueryClient, useMutation } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'

import { call } from '../api/call.ts'
import { apiClient, LONG_REQUEST_TIMEOUT_MS, withTimeout } from '../api/client.ts'

// The table definition's data ("各論 > データベース > テーブル定義書"): one JSON for PDF and
// Markdown alike, which the browser turns into the file. `queryClient` is only needed in tests.

const definitionExport = apiClient.api.versions[':versionId']['definition-export']

export type DefinitionRequest = InferRequestType<typeof definitionExport.$post>['json']
export type DefinitionSections = NonNullable<DefinitionRequest['sections']>
export type DefinitionData = Awaited<ReturnType<typeof fetchDefinition>>

const fetchDefinition = (versionId: string, json: DefinitionRequest) =>
  call(definitionExport.$post({ param: { versionId }, json }, withTimeout(LONG_REQUEST_TIMEOUT_MS)))

export const useDefinitionExport = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: ({ versionId, json }: { versionId: string; json: DefinitionRequest }) =>
        fetchDefinition(versionId, json),
    },
    queryClient,
  )
