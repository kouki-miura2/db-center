import type { InferResponseType } from 'hono/client'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import type { apiClient } from '../api/client.ts'

export type SessionUser = InferResponseType<typeof apiClient.api.auth.me.$get>['user']

/**
 * The signed-in user. `unknown` until the session is first checked (`loadSession`); the API calls
 * themselves live in `src/auth/session.ts`, not here.
 */
export const useAuthStore = defineStore('auth', () => {
  const status = ref<'unknown' | 'signedIn' | 'signedOut'>('unknown')
  const user = ref<SessionUser | null>(null)
  /** The user must agree to the current terms before using the app ("共通ルール > 同意"). */
  const consentRequired = ref(false)

  const setSignedIn = (signedInUser: SessionUser, mustConsent: boolean) => {
    user.value = signedInUser
    consentRequired.value = mustConsent
    status.value = 'signedIn'
  }

  const setSignedOut = () => {
    user.value = null
    consentRequired.value = false
    status.value = 'signedOut'
  }

  const setConsentRequired = (value: boolean) => {
    consentRequired.value = value
  }

  return { status, user, consentRequired, setSignedIn, setSignedOut, setConsentRequired }
})
