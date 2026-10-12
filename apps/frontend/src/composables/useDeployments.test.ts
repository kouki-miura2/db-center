import { QueryClient } from '@tanstack/vue-query'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'

vi.mock('../api/client.ts', () => ({
  LONG_REQUEST_TIMEOUT_MS: 60_000,
  withTimeout: () => ({}),
  apiClient: {
    api: {
      connections: {
        ':connectionId': {
          'deployment-preview': { $post: vi.fn() },
          deployments: { $post: vi.fn() },
        },
      },
      deployments: { ':deploymentId': { $get: vi.fn(), script: { $get: vi.fn() } } },
    },
  },
}))

import { ApiError } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import {
  mayRetrySame,
  reasonText,
  useDeploymentProgress,
  useDeploymentStart,
} from './useDeployments.ts'

const connection = apiClient.api.connections[':connectionId']
const deployment = apiClient.api.deployments[':deploymentId']
const answer = (status: number, body: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as never

const row = (status: string, extra = {}) => ({
  id: 'x1',
  connectionId: 'c1',
  connectionName: '開発',
  kind: 'build',
  fromVersionId: null,
  toVersionId: 'v2',
  status,
  startedAt: 2,
  finishedAt: null,
  log: null,
  executedBy: 'former-member',
  executedByName: '退出した実行者',
  ...extra,
})

const setup = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(scopeKeys.database('d1'), {
    revision: 5,
    data: { versions: [], deployments: [row('succeeded', { id: 'old', startedAt: 1 })] },
  })
  return client
}
const run = <T>(composable: () => T) => {
  const result = effectScope().run(composable)
  if (!result) throw new Error('effectScope.run returned undefined')
  return result
}
const deploymentsIn = (client: QueryClient) =>
  client.getQueryData<{
    revision: number
    data: { deployments: { id: string; status: string; executedByName: string }[] }
  }>(scopeKeys.database('d1'))

beforeEach(() => {
  vi.clearAllMocks()
})

test('starting a run adds it to the history, keeping the scope revision', async () => {
  vi.mocked(connection.deployments.$post).mockReturnValue(answer(202, row('running')))
  const client = setup()
  const start = run(() => useDeploymentStart('d1', client))

  await start.mutateAsync({
    connectionId: 'c1',
    json: { kind: 'build', toVersionId: 'v2', expectedRevision: 3, idempotencyKey: 'k1' },
  })

  expect(connection.deployments.$post).toHaveBeenCalledWith(
    {
      param: { connectionId: 'c1' },
      json: { kind: 'build', toVersionId: 'v2', expectedRevision: 3, idempotencyKey: 'k1' },
    },
    {},
  )
  expect(deploymentsIn(client)?.revision).toBe(5)
  expect(deploymentsIn(client)?.data.deployments.map((d) => d.id)).toEqual(['x1', 'old'])
  expect(deploymentsIn(client)?.data.deployments[0]?.executedByName).toBe('退出した実行者')
})

test('polls a running deployment and checks the database again once it ends', async () => {
  vi.mocked(deployment.$get)
    .mockReturnValueOnce(answer(200, row('running')))
    .mockReturnValueOnce(
      answer(200, row('succeeded', { finishedAt: 9, executedByName: '退会したユーザー' })),
    )
  const client = setup()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  const progress = run(() => useDeploymentProgress('d1', 'x1', client))

  await vi.waitFor(() => expect(progress.data.value?.status).toBe('running'))
  await progress.refetch()

  expect(progress.data.value?.status).toBe('succeeded')
  expect(progress.data.value?.executedByName).toBe('退会したユーザー')
  expect(deploymentsIn(client)?.data.deployments.find((d) => d.id === 'x1')?.executedByName).toBe(
    '退会したユーザー',
  )
  expect(invalidate).toHaveBeenCalledWith({ queryKey: scopeKeys.database('d1'), exact: true })
  expect(deploymentsIn(client)?.data.deployments.find((d) => d.id === 'x1')?.status).toBe(
    'succeeded',
  )
})

test('sends the same key again only when the answer may have been lost', () => {
  expect(mayRetrySame(new ApiError('network', '通信できませんでした'))).toBe(true)
  expect(mayRetrySame(new ApiError('invalid_state', '事前チェックに合格しませんでした'))).toBe(
    false,
  )
})

test('says the reasons of the checks, falling back to the code', () => {
  expect(reasonText('data_loss')).toContain('データ損失')
  expect(reasonText('something_new')).toBe('something_new')
})
