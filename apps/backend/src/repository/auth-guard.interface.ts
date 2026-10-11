/** The user a request is authenticated as, read once per request by the guard. */
export interface AuthenticatedUser {
  id: string
  name: string
  email: string
  /** Terms version the user agreed to; an older one means they must agree again. */
  termsVersion: string
  /** `sessions.id` of the session the request came with. */
  sessionId: string
}

export interface AuthGuard {
  /** Resolves the authenticated user from a request, or `null` if unauthenticated. */
  authenticate: (request: Request) => Promise<AuthenticatedUser | null>
}
