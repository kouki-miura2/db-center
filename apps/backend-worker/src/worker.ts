import { createApp, PUBLIC_PATHS, SESSION_COOKIE } from 'backend/src/app.ts'
import { createMemoryDb } from 'backend/src/dao/memory-db.ts'
import { createSampleDao } from 'backend/src/dao/sample.memory.ts'
import { createUserMemoryDao } from 'backend/src/dao/user.memory.ts'
import { createSessionAuthGuard } from 'backend/src/repository/auth-guard.session.ts'
import { createGoogleIdTokenVerifier } from 'backend/src/repository/google-id-token.jose.ts'
import { createSampleRepository } from 'backend/src/repository/sample.repository.ts'
import { createUserRepository } from 'backend/src/repository/user.repository.ts'
import { createAuthService } from 'backend/src/service/auth.service.ts'
import { createSampleService } from 'backend/src/service/sample.service.ts'

// Not wired to D1 or a Google client ID yet: with no client ID every ID token is rejected, so
// sign-in stays safely off.
const users = createUserMemoryDao(createMemoryDb())

export default createApp({
  sampleService: createSampleService(createSampleRepository(createSampleDao())),
  authService: createAuthService({
    verifier: createGoogleIdTokenVerifier({ clientId: undefined }),
    users: createUserRepository(users),
  }),
  auth: {
    guard: createSessionAuthGuard({ users, cookieName: SESSION_COOKIE.production.name }),
    enabled: false,
    excludePaths: PUBLIC_PATHS,
  },
  sessionCookie: SESSION_COOKIE.production,
})
