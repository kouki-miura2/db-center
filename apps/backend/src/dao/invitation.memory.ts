import { AppError } from '../error.ts'
import type { InvitationDao, InvitationRecord } from './invitation.interface.ts'
import { appendAuditLog, atomic, type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import {
  assertActorRole,
  bumpProductRevision,
  bumpProductsRevision,
  memberKey,
  type MemberRow,
} from './product.memory.ts'
import type { UserRecord } from './user.interface.ts'

const invitations = (db: MemoryDb) => memoryTable<InvitationRecord>(db, 'invitations')

const ofProduct = (db: MemoryDb, productId: string) =>
  [...invitations(db).values()].filter((row) => row.productId === productId)

const memberEmails = (db: MemoryDb, productId: string) =>
  [...memoryTable<MemberRow>(db, 'product_members').values()]
    .filter((row) => row.productId === productId)
    .map((row) => memoryTable<UserRecord>(db, 'users').get(row.userId)?.email)

interface FailureRow {
  id: string
  userId: string
  failedAt: number
}

const failures = (db: MemoryDb) => memoryTable<FailureRow>(db, 'passcode_failures')

const activeProduct = (db: MemoryDb, productId: string) => {
  const product = memoryTable<ProductRecord>(db, 'products').get(productId)
  return product?.deletedAt === null ? product : undefined
}

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

  findForJoin: async (passcodeHash, email, now) => {
    const row = [...invitations(db).values()].find(
      (invitation) =>
        invitation.passcodeHash === passcodeHash &&
        invitation.email === email &&
        invitation.expiresAt > now &&
        activeProduct(db, invitation.productId),
    )
    return row ? { ...row } : null
  },

  countFailures: async (userId, since) =>
    [...failures(db).values()].filter((row) => row.userId === userId && row.failedAt > since)
      .length,

  recordFailure: async (failure) => {
    failures(db).set(failure.id, { ...failure })
  },

  join: async ({ invitation, userId, now, maxMembers, maxProducts, audit }) =>
    atomic(db, () => {
      const current = invitations(db).get(invitation.id)
      if (!current || current.expiresAt <= now || !activeProduct(db, invitation.productId)) {
        throw new AppError('stale_update')
      }
      const members = memoryTable<MemberRow>(db, 'product_members')
      if (members.has(memberKey(invitation.productId, userId))) throw new AppError('duplicate')
      invitations(db).delete(invitation.id)
      members.set(memberKey(invitation.productId, userId), {
        productId: invitation.productId,
        userId,
        role: invitation.role,
        joinedAt: now,
      })
      const rows = [...members.values()]
      const productMembers = rows.filter((row) => row.productId === invitation.productId).length
      const userProducts = rows.filter(
        (row) => row.userId === userId && activeProduct(db, row.productId),
      ).length
      if (productMembers > maxMembers || userProducts > maxProducts) {
        throw new AppError('limit_exceeded')
      }
      const productRevision = bumpProductRevision(db, invitation.productId)
      const productsRevision = bumpProductsRevision(db, userId)
      appendAuditLog(db, audit)
      return { productRevision, productsRevision }
    }),
})
