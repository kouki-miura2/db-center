import { AppError } from '../error.ts'
import { appendAuditLog, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import type { MemberRow } from './product.memory.ts'
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
  findSessionUser: async (sessionId, now) => {
    const session = sessions(db).get(sessionId)
    if (!session || session.expiresAt <= now) return null
    const user = users(db).get(session.userId)
    return user && user.deletedAt === null ? { ...user } : null
  },
  deleteSession: async (sessionId) => {
    sessions(db).delete(sessionId)
  },
  recordConsent: async ({ userId, termsVersion, agreedAt }) =>
    atomic(db, () => {
      const user = users(db).get(userId)
      if (!user || user.deletedAt !== null) throw new AppError('stale_update')
      user.termsVersion = termsVersion
      user.agreedAt = agreedAt
      return { ...user }
    }),

  withdraw: async ({ userId, name, anonymizedName, now }) =>
    atomic(db, () => {
      const user = users(db).get(userId)
      if (!user || user.deletedAt !== null) throw new AppError('stale_update')
      const members = memoryTable<MemberRow>(db, 'product_members')
      const products = memoryTable<ProductRecord>(db, 'products')
      const mine = [...members.entries()].filter(([, row]) => row.userId === userId)
      const ownsActive = mine.some(
        ([, row]) => row.role === 'owner' && products.get(row.productId)?.deletedAt === null,
      )
      if (ownsActive) throw new AppError('stale_update')
      for (const [key, row] of mine) {
        // Owner rows remain only for deleted products, until those are purged.
        if (row.role === 'owner') continue
        const product = products.get(row.productId)
        if (product) product.revision += 1
        members.delete(key)
        appendAuditLog(db, {
          id: crypto.randomUUID(),
          productId: row.productId,
          userId,
          targetType: 'member',
          action: 'leave',
          summary: name,
          createdAt: now,
        })
      }
      sessions(db).forEach((session, id) => {
        if (session.userId === userId) sessions(db).delete(id)
      })
      user.googleSub = null
      user.email = null
      user.name = anonymizedName
      user.deletedAt = now
    }),
})
