import { QueryClient } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'
vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: {
      invitations: { join: { $post: vi.fn() } },
      products: {
        ':productId': {
          invitations: { $post: vi.fn(), ':invitationId': { passcode: { $post: vi.fn() } } },
          members: { ':userId': { $patch: vi.fn(), $delete: vi.fn() } },
          'transfer-owner': { $post: vi.fn() },
          leave: { $post: vi.fn() },
        },
      },
    },
  },
}))
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { useAuthStore } from '../stores/auth.ts'
import { useMemberMutations } from './useMemberMutations.ts'
const answer = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as never
const owner = { userId: 'u1', role: 'owner', name: '山田', joinedAt: 1 }
const member = { userId: 'u2', role: 'member', name: '鈴木', joinedAt: 1 }
beforeEach(() => {
  vi.clearAllMocks()
  setActivePinia(createPinia())
  useAuthStore().setSignedIn({ id: 'u1', name: '山田', email: 'taro@example.com' }, false)
})
const setup = () => {
  const client = new QueryClient()
  client.setQueryData(scopeKeys.productList(), {
    revision: 1,
    data: [{ id: 'p1', name: 'EC', role: 'owner' }],
  })
  client.setQueryData(scopeKeys.product('p1'), {
    revision: 1,
    data: { role: 'owner', members: [owner, member], invitations: [], databases: [] },
  })
  const scope = effectScope()
  return { client, scope, mutations: scope.run(() => useMemberMutations('p1', client))! }
}
test('inviting writes only pending participants into cache, never the returned passcode', async () => {
  const { client, scope, mutations } = setup()
  const invitation = {
    id: 'i1',
    email: 'hana@example.com',
    role: 'member',
    createdAt: 1,
    expiresAt: 2,
  }
  vi.mocked(apiClient.api.products[':productId'].invitations.$post).mockReturnValue(
    answer({
      passcode: 'ABCDEFGH',
      expiresAt: 2,
      invitations: [invitation],
      revisions: { product: 2 },
    }),
  )
  expect(await mutations.invite.mutateAsync([{ email: invitation.email, role: 'member' }])).toEqual(
    { passcode: 'ABCDEFGH', expiresAt: 2 },
  )
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 2,
    data: { invitations: [invitation] },
  })
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((query) => query.state.data),
    ),
  ).not.toContain('ABCDEFGH')
  scope.stop()
  client.clear()
})
test('ownership transfer updates both actor permissions and the product-list role immediately', async () => {
  const { client, scope, mutations } = setup()
  vi.mocked(apiClient.api.products[':productId']['transfer-owner'].$post).mockReturnValue(
    answer({ revisions: { product: 2, products: 3 } }),
  )
  await mutations.transfer.mutateAsync('u2')
  expect(client.getQueryData(scopeKeys.product('p1'))).toMatchObject({
    revision: 2,
    data: {
      role: 'manager',
      members: [
        { userId: 'u1', role: 'manager' },
        { userId: 'u2', role: 'owner' },
      ],
    },
  })
  expect(client.getQueryData(scopeKeys.productList())).toMatchObject({
    revision: 3,
    data: [{ id: 'p1', role: 'manager' }],
  })
  scope.stop()
  client.clear()
})
