import { createApp, PUBLIC_PATHS, SESSION_COOKIE } from 'backend/src/app.ts'
import { createSessionAuthGuard } from 'backend/src/repository/auth-guard.session.ts'
import { createGoogleIdTokenVerifier } from 'backend/src/repository/google-id-token.jose.ts'
import { createProductRepository } from 'backend/src/repository/product.repository.ts'
import { createUserRepository } from 'backend/src/repository/user.repository.ts'
import { createAuthService } from 'backend/src/service/auth.service.ts'
import { createProductService } from 'backend/src/service/product.service.ts'

import { createProductD1Dao } from './dao/product.d1.ts'
import { createUserD1Dao } from './dao/user.d1.ts'

/**
 * Secrets and local-only settings, which `wrangler types` doesn't know about since they aren't in
 * `wrangler.jsonc`:
 * - `GOOGLE_CLIENT_ID`: secret (`wrangler secret put`). Unset, every Google sign-in is rejected.
 * - `DEV_LOGIN`: `"true"` only in the untracked `.dev.vars`, for local development. Turns on the
 *   development login and the http session cookie. Never set it for a deployed Worker.
 */
interface WorkerEnv extends Env {
  GOOGLE_CLIENT_ID?: string
  DEV_LOGIN?: string
}

const buildApp = (env: WorkerEnv) => {
  const users = createUserD1Dao(env.DB)
  const development = env.DEV_LOGIN === 'true'
  const sessionCookie = development ? SESSION_COOKIE.development : SESSION_COOKIE.production
  return createApp({
    authService: createAuthService({
      verifier: createGoogleIdTokenVerifier({ clientId: env.GOOGLE_CLIENT_ID || undefined }),
      users: createUserRepository(users),
    }),
    productService: createProductService({
      products: createProductRepository(createProductD1Dao(env.DB)),
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
