import type { SessionRecord, UserDao, UserRecord } from '../dao/user.interface.ts'

/** A registered, not withdrawn user, as the services see them. */
export interface User {
  id: string
  name: string
  email: string
  termsVersion: string
}

export interface UserRepository {
  findByGoogleSub: (googleSub: string) => Promise<User | null>
  register: (user: UserRecord, session: SessionRecord) => Promise<User>
  recordLogin: (
    login: { userId: string; email: string; lastLoginAt: number },
    session: SessionRecord,
  ) => Promise<User>
  deleteSession: (sessionId: string) => Promise<void>
}

const toUser = (record: UserRecord): User | null =>
  record.deletedAt === null && record.email !== null
    ? { id: record.id, name: record.name, email: record.email, termsVersion: record.termsVersion }
    : null

export const createUserRepository = (dao: UserDao): UserRepository => ({
  findByGoogleSub: async (googleSub) => {
    const record = await dao.findByGoogleSub(googleSub)
    return record ? toUser(record) : null
  },
  register: async (user, session) => {
    await dao.register(user, session)
    return toUser(user) as User
  },
  recordLogin: async (login, session) => toUser(await dao.recordLogin(login, session)) as User,
  deleteSession: (sessionId) => dao.deleteSession(sessionId),
})
