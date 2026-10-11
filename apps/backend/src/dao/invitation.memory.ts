import { AppError } from '../error.ts'
import type { InvitationDao, InvitationRecord } from './invitation.interface.ts'
import { appendAuditLog, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { assertActorRole, bumpProductRevision, type MemberRow } from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

const invitations = (db: MemoryDb) => memoryTable<InvitationRecord>(db, 'invitations')

const ofProduct = (db: MemoryDb, productId: string) =>
  [...invitations(db).values()].filter((row) => row.productId === productId)

const memberEmails = (db: MemoryDb, productId: string) =>
  [...memoryTable<MemberRow>(db, 'product_members').values()]
    .filter((row) => row.productId === productId)
    .map((row) => memoryTable<UserRecord>(db, 'users').get(row.userId)?.email)

/** In-memory `InvitationDao` over the shared `MemoryDb`. */
export const createInvitationMemoryDao = (db: MemoryDb): InvitationDao => ({
  findValid: async (productId, invitationId, now) => {
    const product = memoryTable<ProductRecord>(db, 'products').get(productId)
    const row = invitations(db).get(invitationId)
    return product?.deletedAt === null && row?.productId === productId && row.expiresAt > now
      ? { ...row }
      : null
  },

  create: async ({ productId, invitations: rows, now, maxMembers, userId, allowedRoles, audits }) =>
    atomic(db, () => {
      assertActorRole(db, productId, userId, allowedRoles)
      const members = memberEmails(db, productId)
      for (const row of rows) {
        if (members.includes(row.email)) throw new AppError('duplicate')
        // Re-inviting replaces the earlier invitation of the email.
        for (const old of ofProduct(db, productId)) {
          if (old.email === row.email) invitations(db).delete(old.id)
        }
        invitations(db).set(row.id, { ...row })
      }
      const pending = ofProduct(db, productId).filter((row) => row.expiresAt > now).length
      if (members.length + pending > maxMembers) throw new AppError('limit_exceeded')
      const productRevision = bumpProductRevision(db, productId)
      for (const audit of audits) appendAuditLog(db, audit)
      return { productRevision }
    }),
})
