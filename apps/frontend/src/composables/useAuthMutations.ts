import { type QueryClient, useMutation } from '@tanstack/vue-query'
import { TERMS_VERSION } from 'utils'

import { call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { endSession, signOut, startSession } from '../auth/session.ts'
import { useAuthStore } from '../stores/auth.ts'

// Signing in, registering, agreeing to new terms, signing out and withdrawing
// ("各論 > Googleでログイン", "共通ルール > 同意"). Each starts or ends the session in the app.
// `queryClient` is only needed in tests, to run them outside of a mounted app.

/**
 * Signs in with a Google ID token. A registered user is signed in; an unregistered one gets
 * `registration_required` (with their email and suggested name) and nothing is stored yet.
 */
export const useGoogleSignIn = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: async (idToken: string) => {
        const result = await call(apiClient.api.auth.google.$post({ json: { idToken } }))
        if (result.status === 'signed_in') await startSession(result.user, result.consentRequired)
        return result
      },
    },
    queryClient,
  )

/** Registers after consent: the user is created only now, with the terms version agreed to. */
export const useRegister = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: async ({ idToken, name }: { idToken: string; name: string }) => {
        const { user } = await call(
          apiClient.api.auth.register.$post({
            json: { idToken, name: name.trim(), termsVersion: TERMS_VERSION, agreed: true },
          }),
        )
        await startSession(user, false)
      },
    },
    queryClient,
  )

/** Development only (the API answers 404 unless the runtime turned it on, on localhost). */
export const useDevLogin = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: async (input: { email: string; name: string }) => {
        const { user, consentRequired } = await call(
          apiClient.api.auth['dev-login'].$post({ json: input }),
        )
        await startSession(user, consentRequired)
      },
    },
    queryClient,
  )

/** Agrees to the current terms (a user whose agreed version is older). */
export const useConsent = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: async () => {
        await call(
          apiClient.api.auth.consent.$post({ json: { termsVersion: TERMS_VERSION, agreed: true } }),
        )
        useAuthStore().setConsentRequired(false)
      },
    },
    queryClient,
  )

export const useSignOut = (queryClient?: QueryClient) =>
  useMutation({ mutationFn: signOut }, queryClient)

/** Withdraws (`DELETE /api/auth/me`), then deletes the user's data from the device. */
export const useWithdraw = (queryClient?: QueryClient) =>
  useMutation(
    {
      mutationFn: async () => {
        await call(apiClient.api.auth.me.$delete())
        await endSession()
      },
    },
    queryClient,
  )
