import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { createLogger, LIMITS, TERMS_VERSION } from 'utils'
import { z } from 'zod'

import { AppError, errorResponse } from './error.ts'
import type { AuthGuard, AuthenticatedUser } from './repository/auth-guard.interface.ts'
import type { AuthService, IssuedSession } from './service/auth.service.ts'
import type { SampleService } from './service/sample.service.ts'
import { text, validate } from './validation.ts'

export interface AuthConfig {
  guard: AuthGuard
  /** Off by default (free access). When on, applies to every route except `excludePaths`. */
  enabled: boolean
  excludePaths: string[]
}

/**
 * The session cookie. In production: `__Host-session`, Secure (no Domain, Path=/, so a subdomain
 * can't overwrite it). Local development runs over http, where `__Host-` and Secure can't be used.
 */
export interface SessionCookieConfig {
  name: string
  secure: boolean
}

export const SESSION_COOKIE = {
  production: { name: '__Host-session', secure: true },
  development: { name: 'session', secure: false },
} as const satisfies Record<string, SessionCookieConfig>

/**
 * Paths reachable without a session: signing in, signing up, and signing out (which must work with
 * an expired session too). Runtime packages pass them as `auth.excludePaths`.
 */
export const PUBLIC_PATHS = ['/api/auth/google', '/api/auth/register', '/api/auth/logout']

export interface AppDependencies {
  sampleService: SampleService
  authService: AuthService
  auth: AuthConfig
  sessionCookie: SessionCookieConfig
}

// Long enough for any Google ID token (a JWT of about 1 KB).
const idToken = z.string().min(1).max(8192)

type Variables = { user: AuthenticatedUser | null; requestId: string }

// 4 random bytes as hex: short enough to scan by eye in logs, still ~4 billion values so
// collisions within one log stream are practically a non-issue.
const generateRequestId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/** The authenticated user; throws `unauthorized` when the request has none. */
const requireUser = (c: Context<{ Variables: Variables }>): AuthenticatedUser => {
  const user = c.get('user')
  if (!user) throw new AppError('unauthorized')
  return user
}

/** Runtime-agnostic app: no Cloudflare Workers or Node-specific APIs here. Entrypoints live in the runtime package (`apps/backend-*`). */
export const createApp = (deps: AppDependencies) => {
  const logger = createLogger({ format: 'json' })

  // HttpOnly so scripts can't read it, SameSite=Lax so cross-site requests don't carry it.
  const setSessionCookie = (c: Context, session: IssuedSession) =>
    setCookie(c, deps.sessionCookie.name, session.token, {
      httpOnly: true,
      secure: deps.sessionCookie.secure,
      sameSite: 'Lax',
      path: '/',
      expires: new Date(session.expiresAt),
    })

  return (
    new Hono<{ Variables: Variables }>()
      // Every error, thrown anywhere, leaves as { error: { code, message, fields? }, requestId }.
      .onError((error, c) => {
        if (!(error instanceof AppError)) {
          logger.error('unhandled error', { requestId: c.get('requestId'), error: String(error) })
        }
        return errorResponse(c, error)
      })
      .notFound((c) => errorResponse(c, new AppError('not_found')))
      // Served under /api on the same origin as the frontend (Vite proxies it in dev), so no CORS.
      .basePath('/api')
      // Audit trail: start/end pair per request, joined by requestId (needed since concurrent
      // requests to the same method+path would otherwise be indistinguishable in the log stream).
      // Wraps the auth guard so a rejected (401) request is still logged, not just successful ones.
      .use('*', async (c, next) => {
        const requestId = generateRequestId()
        c.set('requestId', requestId)
        const startedAt = Date.now()

        logger.info('request started', { requestId, method: c.req.method, path: c.req.path })

        try {
          await next()
        } finally {
          logger.info('request completed', {
            requestId,
            method: c.req.method,
            path: c.req.path,
            user: c.get('user')?.id ?? 'anonymous',
            status: c.res.status,
            durationMs: Date.now() - startedAt,
          })
        }
      })
      // Responses carry user-specific data: never stored by a shared HTTP cache (the frontend keeps
      // its own per-user cache in IndexedDB). Set after next() so error responses get it too.
      .use('*', async (c, next) => {
        await next()
        c.header('Cache-Control', 'private, no-store')
      })
      // CSRF: rejects a write that a cross-site page could send without a CORS preflight (form
      // content types, or none) unless Sec-Fetch-Site is same-origin or Origin is this origin.
      // Sec-Fetch-Site also passes through Vite's dev proxy, whose Origin differs from the backend's.
      // JSON writes need a preflight, which fails since there's no CORS. Runs before auth, so it
      // covers sign-in and sign-up as well.
      .use('*', csrf())
      .use('*', async (c, next) => {
        if (deps.auth.enabled && !deps.auth.excludePaths.includes(c.req.path)) {
          const user = await deps.auth.guard.authenticate(c.req.raw)
          if (!user) throw new AppError('unauthorized')
          c.set('user', user)
        } else {
          c.set('user', null)
        }
        await next()
      })
      // Sign in with a Google ID token. A registered user gets a session cookie; an unregistered
      // one only learns that consent is needed, and nothing is stored until `/auth/register`.
      .post('/auth/google', validate('json', z.strictObject({ idToken })), async (c) => {
        const result = await deps.authService.signInWithGoogle(c.req.valid('json').idToken)
        if (result.status === 'registration_required') return c.json(result)
        const { session, ...body } = result
        setSessionCookie(c, session)
        return c.json(body)
      })
      // First consent: verifies the token again and creates the user only after explicit consent
      // to the current terms version.
      .post(
        '/auth/register',
        validate(
          'json',
          z.strictObject({
            idToken,
            name: text(LIMITS.userNameMaxLength).min(1),
            termsVersion: z.string().max(100),
            agreed: z.literal(true),
          }),
        ),
        async (c) => {
          const { idToken, name, termsVersion } = c.req.valid('json')
          const { session, ...body } = await deps.authService.register({
            idToken,
            name,
            termsVersion,
          })
          setSessionCookie(c, session)
          return c.json(body)
        },
      )
      // The signed-in user, and whether they must agree to the current terms first.
      .get('/auth/me', (c) => {
        const user = requireUser(c)
        return c.json({
          user: { id: user.id, name: user.name, email: user.email },
          consentRequired: user.termsVersion !== TERMS_VERSION,
        })
      })
      // Ends this browser's session and clears the cookie, even if the session already expired.
      .post('/auth/logout', async (c) => {
        const token = getCookie(c, deps.sessionCookie.name)
        if (token) await deps.authService.signOut(token)
        deleteCookie(c, deps.sessionCookie.name, { path: '/', secure: deps.sessionCookie.secure })
        return c.body(null, 204)
      })
      // Reference implementation of one endpoint through the app -> service -> repository -> dao
      // layering: the runtime entrypoints wire the concrete dependencies, this route only talks
      // to `SampleService`. Build real routes the same way, then delete this route and the
      // `service/sample.*`, `repository/sample.*`, `dao/sample.*` files once they're not needed
      // as a reference anymore.
      .get('/sample/:id', async (c) => {
        const sample = await deps.sampleService.getSample(c.req.param('id'))
        if (!sample) return c.json({ error: 'Not Found' }, 404)
        return c.json(sample)
      })
  )
}

/** Hono RPC contract consumed by `apps/frontend` via `hc<AppType>()`. */
export type AppType = ReturnType<typeof createApp>
