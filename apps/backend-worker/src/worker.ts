import { createApp, SESSION_COOKIE } from 'backend/src/app.ts'
import { createMemoryDb } from 'backend/src/dao/memory-db.ts'
import { createSampleDao } from 'backend/src/dao/sample.memory.ts'
import { createUserMemoryDao } from 'backend/src/dao/user.memory.ts'
import { createAuthGuard } from 'backend/src/repository/auth-guard.header.ts'
import { createGoogleIdTokenVerifier } from 'backend/src/repository/google-id-token.jose.ts'
import { createSampleRepository } from 'backend/src/repository/sample.repository.ts'
import { createUserRepository } from 'backend/src/repository/user.repository.ts'
import { createAuthService } from 'backend/src/service/auth.service.ts'
import { createSampleService } from 'backend/src/service/sample.service.ts'

// Not wired to D1 or a Google client ID yet: with no client ID every ID token is rejected, so
// sign-in stays safely off.
export default createApp({
  sampleService: createSampleService(createSampleRepository(createSampleDao())),
  authService: createAuthService({
    verifier: createGoogleIdTokenVerifier({ clientId: undefined }),
    users: createUserRepository(createUserMemoryDao(createMemoryDb())),
  }),
  auth: { guard: createAuthGuard(), enabled: false, excludePaths: [] },
  sessionCookie: SESSION_COOKIE.production,
})
