import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import { createLogger, LIMITS, TARGETS, type Target, TERMS_VERSION } from 'utils'
import { z } from 'zod'

import { AppError, errorResponse } from './error.ts'
import type { AuthGuard, AuthenticatedUser } from './repository/auth-guard.interface.ts'
import type { AuthService, IssuedSession } from './service/auth.service.ts'
import type { ProductService } from './service/product.service.ts'
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
export const PUBLIC_PATHS = [
  '/api/auth/google',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/dev-login',
]

/**
 * Paths a signed-in user can still use before agreeing to the current terms: their own account
 * (including withdrawal, `DELETE /api/auth/me`), the consent itself, and signing out.
 */
const CONSENT_EXEMPT_PATHS = ['/api/auth/me', '/api/auth/consent', '/api/auth/logout']

// Development login only answers requests to these hosts, as a second safeguard.
const LOCAL_HOSTNAMES = ['localhost', '127.0.0.1', '[::1]']

export interface AppDependencies {
  authService: AuthService
  productService: ProductService
  auth: AuthConfig
  sessionCookie: SessionCookieConfig
  /**
   * Development login (`POST /api/auth/dev-login`). Off unless the runtime package turns it on
   * explicitly for local development; never on in production.
   */
  devLogin: boolean
}

// Long enough for any Google ID token (a JWT of about 1 KB).
const idToken = z.string().min(1).max(8192)

// Input shared by several routes.
const productId = z.object({ productId: z.uuid() })
const productName = text(LIMITS.productNameMaxLength).min(1)
const target = z.enum(Object.keys(TARGETS) as [Target, ...Target[]])
/** The `updatedAt` the client last read: the write is refused if the data changed since. */
const expectedUpdatedAt = z.number().int().nonnegative()
/** The revision of a scope the client holds, if any (`?revision=`). */
const revisionQuery = z.object({ revision: z.coerce.number().int().positive().optional() })

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
      // A user who agreed to an older terms version can't use the app until they agree again
      // ("総論 > 共通ルール > 同意").
      .use('*', async (c, next) => {
        const user = c.get('user')
        if (
          user &&
          user.termsVersion !== TERMS_VERSION &&
          !CONSENT_EXEMPT_PATHS.includes(c.req.path)
        ) {
          throw new AppError('consent_required')
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
      // Agreement to the current terms by a user whose agreed version is older.
      .post(
        '/auth/consent',
        validate(
          'json',
          z.strictObject({ termsVersion: z.string().max(100), agreed: z.literal(true) }),
        ),
        async (c) => {
          const user = requireUser(c)
          const { termsVersion } = c.req.valid('json')
          return c.json(await deps.authService.consent({ userId: user.id, termsVersion }))
        },
      )
      // Ends this browser's session and clears the cookie, even if the session already expired.
      .post('/auth/logout', async (c) => {
        const token = getCookie(c, deps.sessionCookie.name)
        if (token) await deps.authService.signOut(token)
        deleteCookie(c, deps.sessionCookie.name, { path: '/', secure: deps.sessionCookie.secure })
        return c.body(null, 204)
      })
      // The product list scope ("参照 > データの取得とキャッシュ").
      .get('/products', validate('query', revisionQuery), async (c) => {
        const user = requireUser(c)
        return c.json(
          await deps.productService.listProducts(user.id, c.req.valid('query').revision),
        )
      })
      .post(
        '/products',
        validate('json', z.strictObject({ name: productName, target })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.productService.createProduct({ userId: user.id, ...c.req.valid('json') }),
          )
        },
      )
      .patch(
        '/products/:productId',
        validate('param', productId),
        validate('json', z.strictObject({ name: productName, expectedUpdatedAt })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.productService.renameProduct({
              userId: user.id,
              productId: c.req.valid('param').productId,
              ...c.req.valid('json'),
            }),
          )
        },
      )
      // Development login: signs in as any email without Google. Answers 404 unless the runtime
      // package turned it on explicitly and the request is to localhost.
      .post(
        '/auth/dev-login',
        validate(
          'json',
          z.strictObject({ email: z.email(), name: text(LIMITS.userNameMaxLength).min(1) }),
        ),
        async (c) => {
          if (!deps.devLogin || !LOCAL_HOSTNAMES.includes(new URL(c.req.url).hostname)) {
            throw new AppError('not_found')
          }
          const { session, ...body } = await deps.authService.devSignIn(c.req.valid('json'))
          setSessionCookie(c, session)
          return c.json(body)
        },
      )
  )
}

/** Hono RPC contract consumed by `apps/frontend` via `hc<AppType>()`. */
export type AppType = ReturnType<typeof createApp>
