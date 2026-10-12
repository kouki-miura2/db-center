import { type Context, Hono } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { csrf } from 'hono/csrf'
import {
  createLogger,
  DATABASE_NAME_PATTERN,
  LIMITS,
  TARGETS,
  type Target,
  TERMS_VERSION,
} from 'utils'
import { z } from 'zod'

import { AppError, errorResponse } from './error.ts'
import type { AuthGuard, AuthenticatedUser } from './repository/auth-guard.interface.ts'
import type { AuditLogService } from './service/audit-log.service.ts'
import type { AuthService, IssuedSession } from './service/auth.service.ts'
import { columnSchema } from './service/column.ts'
import type { ConnectionService } from './service/connection.service.ts'
import type { DatabaseService } from './service/database.service.ts'
import { ddlOptionsSchema } from './service/ddl.ts'
import {
  definitionExportSchema,
  type DefinitionExportService,
} from './service/definition-export.service.ts'
import { objectInputSchema } from './service/definition.ts'
import {
  deploymentPreviewSchema,
  deploymentRequestSchema,
  type DeploymentService,
} from './service/deployment.service.ts'
import type { InspectionService } from './service/inspection.service.ts'
import type { InvitationService } from './service/invitation.service.ts'
import type { MemberService } from './service/member.service.ts'
import { migrationOptionsSchema } from './service/migration.ts'
import type { ObjectService } from './service/object.service.ts'
import type { ProductService } from './service/product.service.ts'
import type { RevisionService } from './service/revision.service.ts'
import type { ScriptService } from './service/script.service.ts'
import type { VersionService } from './service/version.service.ts'
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
  connectionService: ConnectionService
  invitationService: InvitationService
  memberService: MemberService
  databaseService: DatabaseService
  objectService: ObjectService
  versionService: VersionService
  scriptService: ScriptService
  definitionExportService: DefinitionExportService
  inspectionService: InspectionService
  deploymentService: DeploymentService
  revisionService: RevisionService
  auditLogService: AuditLogService
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
const versionChange = z.strictObject({
  expectedUpdatedAt,
  expectedRevision: z.number().int().positive(),
  memo: text(LIMITS.commentMaxLength).nullable().default(null),
})
const connectionParams = z.object({ productId: z.uuid(), connectionId: z.uuid() })
const memberParams = z.object({ productId: z.uuid(), userId: z.uuid() })
const databaseParams = z.object({ productId: z.uuid(), databaseId: z.uuid() })
const databaseFields = {
  name: z
    .string()
    .regex(
      DATABASE_NAME_PATTERN,
      '英小文字で始まる英小文字・数字・_ の63文字以内で入力してください',
    ),
  description: text(LIMITS.databaseDescriptionMaxLength),
}
/** The deletion confirmation: the target's name typed again ("総論 > 共通ルール > 削除"). */
const confirmationName = z.string().max(200)
const connectionFields = {
  name: text(LIMITS.connectionNameMaxLength).min(1),
  connectionString: text(LIMITS.connectionStringMaxLength).min(1),
}
// Long enough for any real password; never logged or returned.
const password = z.string().min(1).max(1000)
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
      // Withdrawal (allowed before agreeing to new terms too): ends every session of the user.
      .delete('/auth/me', async (c) => {
        const user = requireUser(c)
        await deps.authService.withdraw({ userId: user.id, name: user.name })
        deleteCookie(c, deps.sessionCookie.name, { path: '/', secure: deps.sessionCookie.secure })
        return c.body(null, 204)
      })
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
      // The product scope.
      .get(
        '/products/:productId',
        validate('param', productId),
        validate('query', revisionQuery),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.productService.getProduct({
              userId: user.id,
              productId: c.req.valid('param').productId,
              clientRevision: c.req.valid('query').revision,
            }),
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
      // Deleting needs the product's name typed again ("総論 > 共通ルール > 削除").
      .delete(
        '/products/:productId',
        validate('param', productId),
        validate('json', z.strictObject({ confirmationName, expectedUpdatedAt })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.productService.deleteProduct({
              userId: user.id,
              productId: c.req.valid('param').productId,
              ...c.req.valid('json'),
            }),
          )
        },
      )
      // Database connections of a product (owner, manager). Passwords go in, never out.
      .post(
        '/products/:productId/connections',
        validate('param', productId),
        validate('json', z.strictObject({ ...connectionFields, password: password.optional() })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.connectionService.createConnection({
              userId: user.id,
              productId: c.req.valid('param').productId,
              ...c.req.valid('json'),
            }),
          )
        },
      )
      .put(
        '/products/:productId/connections/order',
        validate('param', productId),
        validate(
          'json',
          z.strictObject({
            connectionIds: z.array(z.uuid()).max(LIMITS.connectionsPerProduct),
            expectedRevision: z.number().int().positive(),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.connectionService.reorderConnections({
              userId: user.id,
              productId: c.req.valid('param').productId,
              ...c.req.valid('json'),
            }),
          )
        },
      )
      .patch(
        '/products/:productId/connections/:connectionId',
        validate('param', connectionParams),
        // `password`: omitted keeps it, null removes it.
        validate(
          'json',
          z.strictObject({
            ...connectionFields,
            password: password.nullable().optional(),
            expectedUpdatedAt,
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.connectionService.updateConnection({
              userId: user.id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          )
        },
      )
      .delete(
        '/products/:productId/connections/:connectionId',
        validate('param', connectionParams),
        validate('json', z.strictObject({ expectedUpdatedAt })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.connectionService.deleteConnection({
              userId: user.id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          )
        },
      )
      // Invitations: one passcode for everyone invited together, shown to the inviter only.
      .post(
        '/products/:productId/invitations',
        validate('param', productId),
        validate(
          'json',
          z.strictObject({
            invitees: z
              .array(
                z.strictObject({ email: z.email().max(254), role: z.enum(['manager', 'member']) }),
              )
              .min(1)
              .max(LIMITS.membersPerProduct),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.invitationService.invite({
              userId: user.id,
              productId: c.req.valid('param').productId,
              invitees: c.req.valid('json').invitees,
            }),
          )
        },
      )
      .post(
        '/products/:productId/invitations/:invitationId/passcode',
        validate('param', z.object({ productId: z.uuid(), invitationId: z.uuid() })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.invitationService.showPasscode({ userId: user.id, ...c.req.valid('param') }),
          )
        },
      )
      // Members: role changes, removal, ownership transfer and leaving.
      .patch(
        '/products/:productId/members/:userId',
        validate('param', memberParams),
        validate('json', z.strictObject({ role: z.enum(['manager', 'member']) })),
        async (c) => {
          const user = requireUser(c)
          const { productId, userId: targetUserId } = c.req.valid('param')
          return c.json(
            await deps.memberService.changeRole({
              userId: user.id,
              productId,
              targetUserId,
              role: c.req.valid('json').role,
            }),
          )
        },
      )
      .delete(
        '/products/:productId/members/:userId',
        validate('param', memberParams),
        async (c) => {
          const user = requireUser(c)
          const { productId, userId: targetUserId } = c.req.valid('param')
          return c.json(
            await deps.memberService.removeMember({ userId: user.id, productId, targetUserId }),
          )
        },
      )
      .post(
        '/products/:productId/transfer-owner',
        validate('param', productId),
        validate('json', z.strictObject({ userId: z.uuid() })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.memberService.transferOwnership({
              userId: user.id,
              productId: c.req.valid('param').productId,
              targetUserId: c.req.valid('json').userId,
            }),
          )
        },
      )
      .post('/products/:productId/leave', validate('param', productId), async (c) => {
        const user = requireUser(c)
        return c.json(
          await deps.memberService.leave({
            userId: user.id,
            productId: c.req.valid('param').productId,
          }),
        )
      })
      // Databases of a product (create, rename, delete: owner, manager).
      .post(
        '/products/:productId/databases',
        validate('param', productId),
        validate(
          'json',
          z.strictObject({
            ...databaseFields,
            description: databaseFields.description.optional(),
            sourceVersionId: z.uuid().optional(),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          const { name, description, sourceVersionId } = c.req.valid('json')
          return c.json(
            await deps.databaseService.createDatabase({
              userId: user.id,
              productId: c.req.valid('param').productId,
              name,
              description: description ?? '',
              sourceVersionId,
            }),
          )
        },
      )
      // The database scope.
      .get(
        '/products/:productId/databases/:databaseId',
        validate('param', databaseParams),
        validate('query', revisionQuery),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.databaseService.getDatabase({
              userId: user.id,
              ...c.req.valid('param'),
              clientRevision: c.req.valid('query').revision,
            }),
          )
        },
      )
      // Replaces the name and description; an empty description removes it.
      .patch(
        '/products/:productId/databases/:databaseId',
        validate('param', databaseParams),
        validate('json', z.strictObject({ ...databaseFields, expectedUpdatedAt })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.databaseService.updateDatabase({
              userId: user.id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          )
        },
      )
      // The common column set (any member), replaced as a whole.
      .put(
        '/products/:productId/databases/:databaseId/common-columns',
        validate('param', databaseParams),
        validate(
          'json',
          z.strictObject({
            columns: z.array(columnSchema).max(LIMITS.columnsPerTable),
            expectedRevision: z.number().int().positive(),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.databaseService.saveCommonColumns({
              userId: user.id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          )
        },
      )
      .delete(
        '/products/:productId/databases/:databaseId',
        validate('param', databaseParams),
        validate('json', z.strictObject({ confirmationName, expectedUpdatedAt })),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.databaseService.deleteDatabase({
              userId: user.id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          )
        },
      )
      .get(
        '/versions/:versionId',
        validate('param', z.object({ versionId: z.uuid() })),
        validate('query', revisionQuery),
        async (c) =>
          c.json(
            await deps.objectService.getVersion({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              clientRevision: c.req.valid('query').revision,
            }),
          ),
      )
      .post(
        '/versions/:versionId/table-ddl',
        validate('param', z.object({ versionId: z.uuid() })),
        validate(
          'json',
          z.strictObject({ objectKey: z.uuid().optional(), input: objectInputSchema }),
        ),
        async (c) =>
          c.json(
            await deps.objectService.tableDdl({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/view-validation',
        validate('param', z.object({ versionId: z.uuid() })),
        validate(
          'json',
          z.strictObject({
            objectKey: z.uuid().optional(),
            schemaKey: z.uuid().nullable(),
            select: text(LIMITS.versionDefinitionBytes).min(1),
          }),
        ),
        async (c) =>
          c.json(
            await deps.objectService.validateView({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/objects',
        validate('param', z.object({ versionId: z.uuid() })),
        validate(
          'json',
          z.union(
            objectInputSchema.options.map((schema) =>
              schema.extend({ objectKey: z.uuid().optional() }),
            ),
          ),
        ),
        async (c) => {
          const { objectKey, ...input } = c.req.valid('json')
          return c.json(
            await deps.objectService.saveObject({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              input,
              newObjectKey: objectKey,
            }),
          )
        },
      )
      .put(
        '/versions/:versionId/objects/:objectKey',
        validate('param', z.object({ versionId: z.uuid(), objectKey: z.uuid() })),
        validate('json', z.strictObject({ input: objectInputSchema, expectedUpdatedAt })),
        async (c) =>
          c.json(
            await deps.objectService.saveObject({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .delete(
        '/versions/:versionId/objects/:objectKey',
        validate('param', z.object({ versionId: z.uuid(), objectKey: z.uuid() })),
        validate('json', z.strictObject({ confirmationName, expectedUpdatedAt })),
        async (c) =>
          c.json(
            await deps.objectService.deleteObject({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/validate',
        validate('param', z.object({ versionId: z.uuid() })),
        async (c) =>
          c.json(
            await deps.versionService.validate({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/provisional',
        validate('param', z.object({ versionId: z.uuid() })),
        validate('json', versionChange),
        async (c) =>
          c.json(
            await deps.versionService.provisional({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/revert',
        validate('param', z.object({ versionId: z.uuid() })),
        validate('json', versionChange.extend({ acknowledgeApplied: z.boolean().default(false) })),
        async (c) =>
          c.json(
            await deps.versionService.revert({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/finalize',
        validate('param', z.object({ versionId: z.uuid() })),
        validate('json', versionChange.extend({ createNext: z.boolean().default(false) })),
        async (c) =>
          c.json(
            await deps.versionService.finalize({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .post(
        '/products/:productId/databases/:databaseId/versions',
        validate('param', databaseParams),
        validate(
          'json',
          z.strictObject({
            sourceVersionId: z.uuid(),
            expectedUpdatedAt,
            expectedRevision: z.number().int().positive(),
          }),
        ),
        async (c) => {
          const { sourceVersionId, ...input } = c.req.valid('json')
          return c.json(
            await deps.versionService.create({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...input,
              versionId: sourceVersionId,
              memo: null,
            }),
          )
        },
      )
      .post(
        '/versions/:versionId/ddl',
        validate('param', z.object({ versionId: z.uuid() })),
        validate(
          'json',
          z.strictObject({ options: ddlOptionsSchema.default(() => ddlOptionsSchema.parse({})) }),
        ),
        async (c) =>
          c.json(
            await deps.scriptService.ddl({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .get(
        '/deployments/:deploymentId/script',
        validate('param', z.strictObject({ deploymentId: z.uuid() })),
        async (c) =>
          c.json(
            await deps.deploymentService.script({
              ...c.req.valid('param'),
              userId: requireUser(c).id,
            }),
          ),
      )
      .post(
        '/versions/:versionId/finalize-preview',
        validate('param', z.strictObject({ versionId: z.uuid() })),
        validate('json', z.strictObject({})),
        async (c) =>
          c.json(
            await deps.deploymentService.finalizePreview({
              ...c.req.valid('param'),
              userId: requireUser(c).id,
            }),
          ),
      )
      .get(
        '/deployments/:deploymentId',
        validate('param', z.strictObject({ deploymentId: z.uuid() })),
        async (c) =>
          c.json(
            await deps.deploymentService.get({
              ...c.req.valid('param'),
              userId: requireUser(c).id,
            }),
          ),
      )
      .post(
        '/connections/:connectionId/deployment-preview',
        validate('param', z.strictObject({ connectionId: z.uuid() })),
        validate('json', deploymentPreviewSchema),
        async (c) =>
          c.json(
            await deps.deploymentService.preview({
              ...c.req.valid('json'),
              ...c.req.valid('param'),
              userId: requireUser(c).id,
            }),
          ),
      )
      .post(
        '/connections/:connectionId/deployments',
        validate('param', z.strictObject({ connectionId: z.uuid() })),
        validate('json', deploymentRequestSchema),
        async (c) =>
          c.json(
            await deps.deploymentService.accept({
              ...c.req.valid('json'),
              ...c.req.valid('param'),
              userId: requireUser(c).id,
            }),
            202,
          ),
      )
      .post(
        '/connections/:connectionId/inspect',
        validate('param', z.object({ connectionId: z.uuid() })),
        validate('json', z.strictObject({})),
        async (c) =>
          c.json(
            await deps.inspectionService.inspect({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
            }),
          ),
      )
      .post(
        '/versions/:versionId/definition-export',
        validate('param', z.object({ versionId: z.uuid() })),
        validate('json', definitionExportSchema),
        async (c) =>
          c.json(
            await deps.definitionExportService.export({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      // The audit log, newest first: `before` pages back, `after` gets what's new since.
      .post(
        '/databases/:databaseId/migration-script',
        validate('param', z.object({ databaseId: z.uuid() })),
        validate(
          'json',
          z.strictObject({
            fromVersionId: z.uuid(),
            toVersionId: z.uuid(),
            options: migrationOptionsSchema.default(() => migrationOptionsSchema.parse({})),
          }),
        ),
        async (c) =>
          c.json(
            await deps.scriptService.migration({
              userId: requireUser(c).id,
              ...c.req.valid('param'),
              ...c.req.valid('json'),
            }),
          ),
      )
      .get(
        '/products/:productId/audit-logs',
        validate('param', productId),
        validate(
          'query',
          z.object({
            before: z.string().max(100).optional(),
            after: z.string().max(100).optional(),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.auditLogService.list({
              userId: user.id,
              productId: c.req.valid('param').productId,
              ...c.req.valid('query'),
            }),
          )
        },
      )
      // Revisions of several cached scopes at once; the ones the user can't see are left out.
      .post(
        '/revisions/check',
        validate(
          'json',
          z
            .strictObject({
              productList: z.boolean(),
              productIds: z.array(z.uuid()),
              databaseIds: z.array(z.uuid()),
              versionIds: z.array(z.uuid()),
            })
            .refine(
              ({ productIds, databaseIds, versionIds }) =>
                productIds.length + databaseIds.length + versionIds.length <=
                LIMITS.revisionCheckScopes,
              `確認できるスコープは${LIMITS.revisionCheckScopes}件までです`,
            ),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.revisionService.check({ userId: user.id, ...c.req.valid('json') }),
          )
        },
      )
      // Joining with a passcode, as the signed-in user's own email.
      .post(
        '/invitations/join',
        validate(
          'json',
          z.strictObject({
            passcode: z
              .string()
              .trim()
              .regex(/^[0-9A-Za-z]{8}$/),
          }),
        ),
        async (c) => {
          const user = requireUser(c)
          return c.json(
            await deps.invitationService.join({
              userId: user.id,
              userName: user.name,
              email: user.email,
              passcode: c.req.valid('json').passcode,
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
