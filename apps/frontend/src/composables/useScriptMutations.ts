import { type QueryClient, useMutation } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'

import { call } from '../api/call.ts'
import { apiClient, LONG_REQUEST_TIMEOUT_MS, withTimeout } from '../api/client.ts'

// The scripts of "ビルド・マイグレーション > 出力": a version's DDL script, and the update script
// between two versions. Both are generated on each request and never stored ("データ仕様 >
// Cloudflare R2"). `queryClient` is only needed in tests.

const versionDdl = apiClient.api.versions[':versionId'].ddl
const migrationScript = apiClient.api.databases[':databaseId']['migration-script']

export type DdlOptions = NonNullable<InferRequestType<typeof versionDdl.$post>['json']['options']>
export type MigrationOptions = NonNullable<
  InferRequestType<typeof migrationScript.$post>['json']['options']
>
export type MigrationResult = Awaited<ReturnType<typeof fetchMigration>>
export type MigrationChange = MigrationResult['difference']['changes'][number]

const fetchMigration = (
  databaseId: string,
  json: { fromVersionId: string; toVersionId: string; options: MigrationOptions },
) =>
  call(migrationScript.$post({ param: { databaseId }, json }, withTimeout(LONG_REQUEST_TIMEOUT_MS)))

export const useDdlScript = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: ({ versionId, options }: { versionId: string; options: DdlOptions }) =>
        call(
          versionDdl.$post(
            { param: { versionId }, json: { options } },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        ),
    },
    queryClient,
  )

export const useMigrationScript = (databaseId: string, queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: (json: {
        fromVersionId: string
        toVersionId: string
        options: MigrationOptions
      }) => fetchMigration(databaseId, json),
    },
    queryClient,
  )
