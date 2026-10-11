import { AppError } from '../error.ts'
import { atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { SessionRecord, UserDao, UserRecord } from './user.interface.ts'

const users = (db: MemoryDb) => memoryTable<UserRecord>(db, 'users')
const sessions = (db: MemoryDb) => memoryTable<SessionRecord>(db, 'sessions')

/** In-memory `UserDao` over the shared `MemoryDb`. */
export const createUserMemoryDao = (db: MemoryDb): UserDao => ({
  findByGoogleSub: async (googleSub) => {
    const user = [...users(db).values()].find((row) => row.googleSub === googleSub)
    return user ? { ...user } : null
  },
  register: async (user, session) =>
    atomic(db, () => {
      if ([...users(db).values()].some((row) => row.googleSub === user.googleSub)) {
        throw new AppError('duplicate')
      }
      users(db).set(user.id, { ...user })
      sessions(db).set(session.id, { ...session })
    }),
  recordLogin: async ({ userId, email, lastLoginAt }, session) =>
    atomic(db, () => {
      const user = users(db).get(userId)
      if (!user || user.deletedAt !== null) throw new AppError('stale_update')
      user.email = email
      user.lastLoginAt = lastLoginAt
      sessions(db).set(session.id, { ...session })
      return { ...user }
    }),
})
