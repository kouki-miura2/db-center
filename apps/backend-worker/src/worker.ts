import { createApp, PUBLIC_PATHS, SESSION_COOKIE } from 'backend/src/app.ts'
import { createAuditLogRepository } from 'backend/src/repository/audit-log.repository.ts'
import { createSessionAuthGuard } from 'backend/src/repository/auth-guard.session.ts'
import { createConnectionRepository } from 'backend/src/repository/connection.repository.ts'
import { createDatabaseRepository } from 'backend/src/repository/database.repository.ts'
import { createGoogleIdTokenVerifier } from 'backend/src/repository/google-id-token.jose.ts'
import { createInvitationRepository } from 'backend/src/repository/invitation.repository.ts'
import { createMemberRepository } from 'backend/src/repository/member.repository.ts'
import { createProductRepository } from 'backend/src/repository/product.repository.ts'
import { createAesGcmSecretBox } from 'backend/src/repository/secret-box.aes-gcm.ts'
import { createUserRepository } from 'backend/src/repository/user.repository.ts'
import { createAuditLogService } from 'backend/src/service/audit-log.service.ts'
import { createAuthService } from 'backend/src/service/auth.service.ts'
import { createConnectionService } from 'backend/src/service/connection.service.ts'
import { createDatabaseService } from 'backend/src/service/database.service.ts'
import { createInvitationService } from 'backend/src/service/invitation.service.ts'
import { createMemberService } from 'backend/src/service/member.service.ts'
import { createProductService } from 'backend/src/service/product.service.ts'

import { createAuditLogD1Dao } from './dao/audit-log.d1.ts'
import { createConnectionD1Dao } from './dao/connection.d1.ts'
import { createDatabaseD1Dao } from './dao/database.d1.ts'
import { createInvitationD1Dao } from './dao/invitation.d1.ts'
import { createMemberD1Dao } from './dao/member.d1.ts'
import { createProductD1Dao } from './dao/product.d1.ts'
import { createUserD1Dao } from './dao/user.d1.ts'

/**
 * Secrets and local-only settings, which `wrangler types` doesn't know about since they aren't in
 * `wrangler.jsonc`:
 * - `GOOGLE_CLIENT_ID`: secret (`wrangler secret put`). Unset, every Google sign-in is rejected.
 * - `ENCRYPTION_KEY`: secret, 32 random bytes in base64, encrypting connection passwords and
 *   invitation passcodes. Unset, setting a password or inviting is refused.
 * - `DEV_LOGIN`: `"true"` only in the untracked `.dev.vars`, for local development. Turns on the
 *   development login and the http session cookie. Never set it for a deployed Worker.
 */
interface WorkerEnv extends Env {
  GOOGLE_CLIENT_ID?: string
  ENCRYPTION_KEY?: string
  DEV_LOGIN?: string
}

const buildApp = (env: WorkerEnv) => {
  const users = createUserD1Dao(env.DB)
  const development = env.DEV_LOGIN === 'true'
  const sessionCookie = development ? SESSION_COOKIE.development : SESSION_COOKIE.production
  const products = createProductRepository(createProductD1Dao(env.DB))
  const secrets = createAesGcmSecretBox(env.ENCRYPTION_KEY || undefined)
  return createApp({
    authService: createAuthService({
      verifier: createGoogleIdTokenVerifier({ clientId: env.GOOGLE_CLIENT_ID || undefined }),
      users: createUserRepository(users),
    }),
    productService: createProductService({ products }),
    connectionService: createConnectionService({
      products,
      connections: createConnectionRepository(createConnectionD1Dao(env.DB)),
      secrets,
    }),
    invitationService: createInvitationService({
      products,
      invitations: createInvitationRepository(createInvitationD1Dao(env.DB)),
      secrets,
    }),
    memberService: createMemberService({
      products,
      members: createMemberRepository(createMemberD1Dao(env.DB)),
    }),
    databaseService: createDatabaseService({
      products,
      databases: createDatabaseRepository(createDatabaseD1Dao(env.DB)),
    }),
    auditLogService: createAuditLogService({
      products,
      auditLogs: createAuditLogRepository(createAuditLogD1Dao(env.DB)),
    }),
    auth: {
      guard: createSessionAuthGuard({ users, cookieName: sessionCookie.name }),
      enabled: true,
      excludePaths: PUBLIC_PATHS,
    },
    sessionCookie,
    devLogin: development,
  })
}

// Bindings only exist per request, and are the same for every request to this isolate: build the
// app on the first one and reuse it.
let app: ReturnType<typeof buildApp> | undefined

export default {
  fetch: (request, env, ctx) => (app ??= buildApp(env)).fetch(request, env, ctx),
} satisfies ExportedHandler<WorkerEnv>
