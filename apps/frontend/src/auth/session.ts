import type { QueryClient } from '@tanstack/vue-query'
import { del, get, set } from 'idb-keyval'
import type { Router } from 'vue-router'

import { ApiError, call, isNetworkError } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { removePersisted, startPersisting } from '../cache/persist.ts'
import { queryClient } from '../plugins/query.ts'
import { type SessionUser, useAuthStore } from '../stores/auth.ts'

// The session in the browser: who is signed in, and their cache on the device. The session
// itself is an HttpOnly cookie the API sets; the last signed-in user is also kept on the device
// so the app opens offline with the last data, read-only ("共通ルール > オフライン").

const LAST_USER_KEY = 'session-user'

let stopPersisting: (() => void) | null = null

/** Starts the user's session in the app: restores their cache, then marks them signed in. */
export const startSession = async (user: SessionUser, consentRequired: boolean) => {
  const auth = useAuthStore()
  if (auth.user?.id !== user.id) {
    stopPersisting?.()
    queryClient.clear()
    stopPersisting = await startPersisting(queryClient, user.id)
  }
  await set(LAST_USER_KEY, user).catch(() => {})
  auth.setSignedIn(user, consentRequired)
}

/**
 * Checks the session once, when the app opens (`GET /api/auth/me`). Offline, the last signed-in
 * user carries on with their cached data.
 */
export const loadSession = async () => {
  try {
    const { user, consentRequired } = await call(apiClient.api.auth.me.$get())
    await startSession(user, consentRequired)
  } catch (error) {
    const lastUser = isNetworkError(error)
      ? await get<SessionUser>(LAST_USER_KEY).catch(() => undefined)
      : undefined
    if (lastUser) await startSession(lastUser, false)
    else useAuthStore().setSignedOut()
  }
}

/** Ends the session in the app and deletes the user's data from the device. */
export const endSession = async () => {
  const auth = useAuthStore()
  const userId = auth.user?.id
  stopPersisting?.()
  stopPersisting = null
  queryClient.clear()
  if (userId) await removePersisted(userId)
  await del(LAST_USER_KEY).catch(() => {})
  auth.setSignedOut()
}

/** Signs out (`POST /api/auth/logout`); the data on the device goes even if the request fails. */
export const signOut = async () => {
  await call(apiClient.api.auth.logout.$post()).catch(() => {})
  await endSession()
}

/**
 * Sends the person to sign in when the session has expired, and to the consent screen when the
 * terms changed, whichever query or mutation finds it out. Called once, from `main.ts`.
 */
export const listenForAuthErrors = (client: QueryClient, router: Router) => {
  const handle = (error: unknown) => {
    if (!(error instanceof ApiError)) return
    const auth = useAuthStore()
    if (error.code === 'unauthorized') {
      auth.setSignedOut()
      void router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
    } else if (error.code === 'consent_required') {
      auth.setConsentRequired(true)
      void router.push({ name: 'consent' })
    }
  }
  client.getQueryCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') handle(event.action.error)
  })
  client.getMutationCache().subscribe((event) => {
    if (event.type === 'updated' && event.action.type === 'error') handle(event.action.error)
  })
}
