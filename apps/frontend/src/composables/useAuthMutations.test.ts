import { QueryClient } from '@tanstack/vue-query'
import { createPinia, setActivePinia } from 'pinia'
import { TERMS_VERSION } from 'utils'
import { beforeEach, expect, test, vi } from 'vite-plus/test'
import { effectScope } from 'vue'

vi.mock('../api/client.ts', () => ({
  apiClient: {
    api: {
      auth: {
        google: { $post: vi.fn() },
        register: { $post: vi.fn() },
        consent: { $post: vi.fn() },
        me: { $delete: vi.fn() },
      },
    },
  },
}))
vi.mock('../auth/session.ts', () => ({
  startSession: vi.fn(),
  endSession: vi.fn(),
  signOut: vi.fn(),
}))

import { apiClient } from '../api/client.ts'
import { endSession, startSession } from '../auth/session.ts'
import { useAuthStore } from '../stores/auth.ts'
import { useConsent, useGoogleSignIn, useRegister, useWithdraw } from './useAuthMutations.ts'

const user = { id: 'u1', name: '山田 太郎', email: 'taro@example.com' }

const answer = (status: number, body?: unknown) =>
  ({ ok: status < 300, status, json: async () => body }) as never

/** Runs a mutation composable in its own effect scope with a throwaway query client. */
const run = <T>(composable: (queryClient: QueryClient) => T) => {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const result = effectScope().run(() => composable(queryClient))
  if (!result) throw new Error('effectScope.run returned undefined')
  return result
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

test('signs a registered user in', async () => {
  vi.mocked(apiClient.api.auth.google.$post).mockReturnValue(
    answer(200, { status: 'signed_in', user, consentRequired: false }),
  )

  const result = await run(useGoogleSignIn).mutateAsync('id-token')

  expect(result.status).toBe('signed_in')
  expect(apiClient.api.auth.google.$post).toHaveBeenCalledWith({ json: { idToken: 'id-token' } })
  expect(startSession).toHaveBeenCalledWith(user, false)
})

test('starts no session for an account not registered yet', async () => {
  vi.mocked(apiClient.api.auth.google.$post).mockReturnValue(
    answer(200, {
      status: 'registration_required',
      email: 'taro@example.com',
      suggestedName: 'Taro',
    }),
  )

  const result = await run(useGoogleSignIn).mutateAsync('id-token')

  expect(result).toMatchObject({ status: 'registration_required', email: 'taro@example.com' })
  expect(startSession).not.toHaveBeenCalled()
})

test('registers with the trimmed name and the current terms version', async () => {
  vi.mocked(apiClient.api.auth.register.$post).mockReturnValue(
    answer(200, { status: 'signed_in', user, consentRequired: false }),
  )

  await run(useRegister).mutateAsync({ idToken: 'id-token', name: ' 山田 太郎 ' })

  expect(apiClient.api.auth.register.$post).toHaveBeenCalledWith({
    json: { idToken: 'id-token', name: '山田 太郎', termsVersion: TERMS_VERSION, agreed: true },
  })
  expect(startSession).toHaveBeenCalledWith(user, false)
})

test('agreeing to new terms lets the user in', async () => {
  vi.mocked(apiClient.api.auth.consent.$post).mockReturnValue(
    answer(200, { user, consentRequired: false }),
  )
  useAuthStore().setSignedIn(user, true)

  await run(useConsent).mutateAsync()

  expect(apiClient.api.auth.consent.$post).toHaveBeenCalledWith({
    json: { termsVersion: TERMS_VERSION, agreed: true },
  })
  expect(useAuthStore().consentRequired).toBe(false)
})

test('withdrawing deletes the data from the device only once the API accepted it', async () => {
  vi.mocked(apiClient.api.auth.me.$delete).mockReturnValueOnce(
    answer(409, { error: { code: 'stale_update', message: '他のユーザーが更新しました' } }),
  )
  const withdraw = run(useWithdraw)

  await expect(withdraw.mutateAsync()).rejects.toMatchObject({ code: 'stale_update' })
  expect(endSession).not.toHaveBeenCalled()

  vi.mocked(apiClient.api.auth.me.$delete).mockReturnValueOnce(answer(204))
  await withdraw.mutateAsync()
  expect(endSession).toHaveBeenCalled()
})
