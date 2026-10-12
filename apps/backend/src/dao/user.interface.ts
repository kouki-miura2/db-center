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
  /**
   * The user of a session that hasn't expired at `now`, or null (unknown or expired session,
   * withdrawn user). Reads the session and the user by primary key only.
   */
  findSessionUser: (sessionId: string, now: number) => Promise<UserRecord | null>
  /** Deletes the session if it exists. */
  deleteSession: (sessionId: string) => Promise<void>
  /** Records consent to a terms version. Throws `stale_update` if the user is gone or withdrawn. */
  recordConsent: (consent: {
    userId: string
    termsVersion: string
    agreedAt: number
  }) => Promise<UserRecord>
  /**
   * Withdraws the user ("各論 > Googleでログイン > 退会"): leaves every product they're a manager or
   * member of (bumping its revision, with a `leave` audit log entry summarized as `name`), deletes
   * all their sessions, clears the Google account ID and email and renames them `anonymizedName`.
   * Bumps the database and deployment revisions of their histories so caches anonymize the name.
   * Throws `stale_update` if they own a product that isn't deleted, or are already withdrawn.
   */
  withdraw: (input: {
    userId: string
    name: string
    anonymizedName: string
    now: number
  }) => Promise<void>
}
