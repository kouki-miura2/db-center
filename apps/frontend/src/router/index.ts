import { createRouter, createWebHistory } from 'vue-router'

import { loadSession } from '../auth/session.ts'
import { useAuthStore } from '../stores/auth.ts'
import { redirectFor } from './guard.ts'
import { routes } from './routes.ts'

export const router = createRouter({
  history: createWebHistory(),
  routes,
})

// The first navigation waits for the session check (`GET /api/auth/me`), every one is guarded.
router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (auth.status === 'unknown') await loadSession()
  return redirectFor(to, auth) ?? true
})
