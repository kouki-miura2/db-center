import { parse } from 'hono/utils/cookie'

import type { UserDao } from '../dao/user.interface.ts'
import { hashSessionToken } from '../service/session-token.ts'
import type { AuthGuard } from './auth-guard.interface.ts'

/**
 * Authenticates a request by its session cookie: the token's hash is the session's primary key,
 * so one lookup finds the session and its user. Unknown or expired sessions and withdrawn users
 * are unauthenticated.
 */
export const createSessionAuthGuard = ({
  users,
  cookieName,
}: {
  users: UserDao
  cookieName: string
}): AuthGuard => ({
  authenticate: async (request) => {
    const token = parse(request.headers.get('cookie') ?? '', cookieName)[cookieName]
    if (!token) return null
    const sessionId = await hashSessionToken(token)
    const user = await users.findSessionUser(sessionId, Date.now())
    if (!user?.email) return null
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      termsVersion: user.termsVersion,
      sessionId,
    }
  },
})
