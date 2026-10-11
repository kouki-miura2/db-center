import type { SessionRecord, UserDao, UserRecord } from 'backend/src/dao/user.interface.ts'

import { runBatch, staleGuard } from './batch.ts'

interface UserRow {
  id: string
  google_sub: string | null
  email: string | null
  name: string
  terms_version: string
  agreed_at: number
  last_login_at: number
  products_revision: number
  created_at: number
  deleted_at: number | null
}

const toRecord = (row: UserRow): UserRecord => ({
  id: row.id,
  googleSub: row.google_sub,
  email: row.email,
  name: row.name,
  termsVersion: row.terms_version,
  agreedAt: row.agreed_at,
  lastLoginAt: row.last_login_at,
  productsRevision: row.products_revision,
  createdAt: row.created_at,
  deletedAt: row.deleted_at,
})

const insertSession = (db: D1Database, session: SessionRecord) =>
  db
    .prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(session.id, session.userId, session.expiresAt, session.createdAt)

/** D1 `UserDao` (users and sessions). */
export const createUserD1Dao = (db: D1Database): UserDao => ({
  findByGoogleSub: async (googleSub) => {
    const row = await db
      .prepare('SELECT * FROM users WHERE google_sub = ?')
      .bind(googleSub)
      .first<UserRow>()
    return row ? toRecord(row) : null
  },
  register: async (user, session) => {
    // The UNIQUE google_sub makes a concurrent second registration fail as `duplicate`.
    await runBatch(db, [
      db
        .prepare(
          'INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          user.id,
          user.googleSub,
          user.email,
          user.name,
          user.termsVersion,
          user.agreedAt,
          user.lastLoginAt,
          user.productsRevision,
          user.createdAt,
          user.deletedAt,
        ),
      insertSession(db, session),
    ])
  },
  recordLogin: async ({ userId, email, lastLoginAt }, session) => {
    const [updated] = await runBatch(db, [
      db
        .prepare(
          'UPDATE users SET email = ?, last_login_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING *',
        )
        .bind(email, lastLoginAt, userId),
      staleGuard(db),
      insertSession(db, session),
    ])
    return toRecord(updated?.results[0] as UserRow)
  },
  findSessionUser: async (sessionId, now) => {
    const row = await db
      .prepare(
        'SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ? AND users.deleted_at IS NULL',
      )
      .bind(sessionId, now)
      .first<UserRow>()
    return row ? toRecord(row) : null
  },
  deleteSession: async (sessionId) => {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(sessionId).run()
  },
  recordConsent: async ({ userId, termsVersion, agreedAt }) => {
    const [updated] = await runBatch(db, [
      db
        .prepare(
          'UPDATE users SET terms_version = ?, agreed_at = ? WHERE id = ? AND deleted_at IS NULL RETURNING *',
        )
        .bind(termsVersion, agreedAt, userId),
      staleGuard(db),
    ])
    return toRecord(updated?.results[0] as UserRow)
  },
})
