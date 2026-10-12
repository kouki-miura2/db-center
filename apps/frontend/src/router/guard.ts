import type { RouteLocationNormalized, RouteLocationRaw } from 'vue-router'

interface SessionState {
  status: 'unknown' | 'signedIn' | 'signedOut'
  consentRequired: boolean
}

const HOME = { name: 'products' } as const

/**
 * Where a navigation must go instead, or `null` to let it through: signed-out people sign in
 * first (and come back afterwards), a user who must agree to new terms sees only the consent
 * screen, and the sign-in screen sends a signed-in user home. Screens marked `public` (sign-in,
 * terms, privacy policy) are open to anyone.
 */
export const redirectFor = (
  to: Pick<RouteLocationNormalized, 'name' | 'meta' | 'fullPath'>,
  session: SessionState,
): RouteLocationRaw | null => {
  const signedIn = session.status === 'signedIn'
  if (to.meta.public) return signedIn && to.name === 'login' ? HOME : null
  if (!signedIn) return { name: 'login', query: { redirect: to.fullPath } }
  if (session.consentRequired) return to.meta.consent ? null : { name: 'consent' }
  return to.meta.consent ? HOME : null
}

/**
 * Where to go after signing in: the `redirect` query if it's a path inside the app, otherwise the
 * product list. Anything else (another origin, `//host`, a URL) is ignored.
 */
export const safeRedirect = (redirect: unknown): RouteLocationRaw =>
  typeof redirect === 'string' && /^\/(?![/\\])/.test(redirect) ? redirect : HOME
