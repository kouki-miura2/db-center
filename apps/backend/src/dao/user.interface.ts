/** One `users` row. `googleSub` and `email` are null after withdrawal. */
export interface UserRecord {
  id: string
  googleSub: string | null
  email: string | null
  name: string
  termsVersion: string
  agreedAt: number
  lastLoginAt: number
  productsRevision: number
  createdAt: number
  deletedAt: number | null
}

/** One `sessions` row. `id` is the SHA-256 of the session token; the token itself is never stored. */
export interface SessionRecord {
  id: string
  userId: string
  expiresAt: number
  createdAt: number
}

export interface UserDao {
  /** The user signed in with this Google account, or null if none (withdrawn users have no `googleSub`). */
  findByGoogleSub: (googleSub: string) => Promise<UserRecord | null>
  /** Creates the user and their first session together. Throws `duplicate` if the Google account is taken. */
  register: (user: UserRecord, session: SessionRecord) => Promise<void>
  /**
   * Records a sign-in (latest email, last login) and creates the session together. Throws
   * `stale_update` if the user is gone or withdrawn.
   */
  recordLogin: (
    login: { userId: string; email: string; lastLoginAt: number },
    session: SessionRecord,
  ) => Promise<UserRecord>
}
