import { Hono } from 'hono'
import { csrf } from 'hono/csrf'
import { createLogger } from 'utils'

import { AppError, errorResponse } from './error.ts'
import type { AuthGuard, AuthenticatedUser } from './repository/auth-guard.interface.ts'
import type { SampleService } from './service/sample.service.ts'

export interface AuthConfig {
  guard: AuthGuard
  /** Off by default (free access). When on, applies to every route except `excludePaths`. */
  enabled: boolean
  excludePaths: string[]
}

export interface AppDependencies {
  sampleService: SampleService
  auth: AuthConfig
}

type Variables = { user: AuthenticatedUser | null; requestId: string }

// 4 random bytes as hex: short enough to scan by eye in logs, still ~4 billion values so
// collisions within one log stream are practically a non-issue.
const generateRequestId = (): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(4)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')

/** Runtime-agnostic app: no Cloudflare Workers or Node-specific APIs here. Entrypoints live in the runtime package (`apps/backend-*`). */
export const createApp = (deps: AppDependencies) => {
  const logger = createLogger({ format: 'json' })

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
