import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'
import { computed, type MaybeRefOrGetter, toValue } from 'vue'

import { ApiError, call } from '../api/call.ts'
import { apiClient, LONG_REQUEST_TIMEOUT_MS, withTimeout } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { updateScope } from '../cache/update.ts'
import { type DatabaseData, mergeDatabase } from './useDatabaseQuery.ts'

// Automatic builds and migrations ("ビルド・マイグレーション > 自動ビルド・自動マイグレーション"):
// the checks against the connection, accepting a run (asynchronous, idempotent), its progress
// (the only polling there is) and the SQL it ran. `queryClient` is only needed in tests.

const connection = apiClient.api.connections[':connectionId']
const deployment = apiClient.api.deployments[':deploymentId']

export type DeploymentRequest = InferRequestType<typeof connection.deployments.$post>['json']
export type DeploymentPreviewInput = Omit<DeploymentRequest, 'idempotencyKey'>
export type DeploymentPreview = Awaited<ReturnType<typeof fetchPreview>>
/** The execution log the runner keeps (`deployments.log`): statements by step, where it got to. */
export interface DeploymentLog {
  groups?: Record<string, { statements: number; rows: number; durationMs: number }>
  lastStep?: {
    index: number
    objectKey: string | null
    phase: string
    kind: string
    status: 'running' | 'succeeded'
  } | null
  committed?: boolean
  precheckReasons?: string[]
  code?: string
  requiresInspection?: boolean
  reconciled?: boolean
}
export type Deployment = Omit<DatabaseData['deployments'][number], 'log'> & {
  log: DeploymentLog | null
}

/** How often a running deployment's row is read again. */
export const PROGRESS_INTERVAL_MS = 2_000

const fetchPreview = (connectionId: string, json: DeploymentPreviewInput) =>
  call(
    connection['deployment-preview'].$post(
      { param: { connectionId }, json },
      withTimeout(LONG_REQUEST_TIMEOUT_MS),
    ),
  )

/** Puts a deployment into the database scope's history, keeping the cached revision. */
const withDeployment = (client: QueryClient, databaseId: string, row: { id: string }) => {
  const key = scopeKeys.database(databaseId)
  const revision = client.getQueryData<{ revision: number }>(key)?.revision ?? 0
  // The response doesn't say the scope's new revision: the next check fetches the delta.
  updateScope<DatabaseData>(client, key, revision, (data) =>
    mergeDatabase(data, {
      ...data,
      deployments: [row as unknown as DatabaseData['deployments'][number]],
    }),
  )
}

/** What the connection would do: its state, the reasons it can't run, the SQL. */
export const useDeploymentPreview = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: ({
        connectionId,
        json,
      }: {
        connectionId: string
        json: DeploymentPreviewInput
      }) => fetchPreview(connectionId, json),
    },
    queryClient,
  )

/**
 * Accepts a run. Sending the same `idempotencyKey` again (after a lost answer) returns the same
 * deployment instead of starting another.
 */
export const useDeploymentStart = (databaseId: string, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  return useMutation(
    {
      mutationFn: async ({
        connectionId,
        json,
      }: {
        connectionId: string
        json: DeploymentRequest
      }) => {
        const row = await call(
          connection.deployments.$post(
            { param: { connectionId }, json },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        )
        withDeployment(client, databaseId, row)
        client.setQueryData(['deployment', row.id], row)
        return row
      },
    },
    client,
  )
}

/**
 * One deployment, read again every `PROGRESS_INTERVAL_MS` while it runs. When it ends, the
 * database scope is checked again (its history and what's applied changed).
 */
export const useDeploymentProgress = (
  databaseId: string,
  deploymentId: MaybeRefOrGetter<string>,
  queryClient?: QueryClient,
) => {
  const client = queryClient ?? useQueryClient()
  return useQuery<Deployment, Error, Deployment, readonly unknown[]>(
    {
      queryKey: computed(() => ['deployment', toValue(deploymentId)] as const),
      enabled: computed(() => !!toValue(deploymentId)),
      queryFn: async (): Promise<Deployment> => {
        const id = toValue(deploymentId)
        const before = client.getQueryData<Deployment>(['deployment', id])
        const row = (await call(deployment.$get({ param: { deploymentId: id } }))) as Deployment
        if (before?.status === 'running' && row.status !== 'running') {
          withDeployment(client, databaseId, row)
          void client.invalidateQueries({ queryKey: scopeKeys.database(databaseId), exact: true })
        }
        return row
      },
      // The history row as the database scope has it, until the first read.
      initialData: () =>
        client
          .getQueryData<{ data: { deployments: Deployment[] } }>(scopeKeys.database(databaseId))
          ?.data.deployments.find((d) => d.id === toValue(deploymentId)),
      initialDataUpdatedAt: 0,
      refetchInterval: (query) =>
        query.state.data?.status === 'running' ? PROGRESS_INTERVAL_MS : false,
      // Keep polling in a background tab: the run goes on whether the screen shows or not.
      refetchIntervalInBackground: true,
      staleTime: 0,
    },
    client,
  )
}

/** The SQL a deployment ran, as stored when it was accepted. */
export const useDeploymentScript = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: (deploymentId: string) =>
        call(deployment.script.$get({ param: { deploymentId } })),
    },
    queryClient,
  )

/** The reasons of the checks, as the screen says them. */
export const REASONS: Record<string, string> = {
  not_configured: '自動実行用の保存先・Workflow が設定されていません',
  unsupported_postgres: '接続先が PostgreSQL 18 ではありません',
  database_not_empty:
    '接続先が空ではありません。既存オブジェクトがある接続先にはマイグレーションを使用してください',
  applied_version_mismatch: '接続先の適用済みバージョンが更新前のバージョンと一致しません',
  drift_unverifiable: '接続先の設計外の変更（ドリフト）を確認できません',
  drift_detected: '接続先に設計外の変更（ドリフト）があります',
  data_loss: '差分にデータ損失（テーブル・カラムの削除など）を含みます',
}

export const reasonText = (reason: string) => REASONS[reason] ?? reason

/** Whether the error means the request may or may not have arrived (send it again as is). */
export const mayRetrySame = (error: unknown) =>
  error instanceof ApiError && error.code === 'network'
