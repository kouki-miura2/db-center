import type { InvitationDao, InvitationRecord } from 'backend/src/dao/invitation.interface.ts'

import { guard, insertAuditLog, limitGuard, runBatch, staleGuard } from './batch.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

export interface InvitationRow {
  id: string
  product_id: string
  email: string
  role: InvitationRecord['role']
  passcode_hash: string
  passcode_encrypted: string
  invited_by: string
  expires_at: number
  created_at: number
}

export const toInvitationRecord = (row: InvitationRow): InvitationRecord => ({
  id: row.id,
  productId: row.product_id,
  email: row.email,
  role: row.role,
  passcodeHash: row.passcode_hash,
  passcodeEncrypted: row.passcode_encrypted,
  invitedBy: row.invited_by,
  expiresAt: row.expires_at,
  createdAt: row.created_at,
})

/** D1 `InvitationDao`. */
export const createInvitationD1Dao = (db: D1Database): InvitationDao => ({
  findValid: async (productId, invitationId, now) => {
    const row = await db
      .prepare(
        'SELECT invitations.* FROM invitations JOIN products ON products.id = invitations.product_id WHERE invitations.id = ? AND invitations.product_id = ? AND invitations.expires_at > ? AND products.deleted_at IS NULL',
      )
      .bind(invitationId, productId, now)
      .first<InvitationRow>()
    return row ? toInvitationRecord(row) : null
  },

  create: async ({ productId, invitations, now, maxMembers, userId, allowedRoles, audits }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      ...invitations.flatMap((invitation) => [
        guard(
          db,
          'duplicate',
          'EXISTS (SELECT 1 FROM product_members JOIN users ON users.id = product_members.user_id WHERE product_members.product_id = ? AND users.email = ?)',
          productId,
          invitation.email,
        ),
        // Re-inviting replaces the earlier invitation of the email.
        db
          .prepare('DELETE FROM invitations WHERE product_id = ? AND email = ?')
          .bind(productId, invitation.email),
        db
          .prepare(
            'INSERT INTO invitations (id, product_id, email, role, passcode_hash, passcode_encrypted, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
          )
          .bind(
            invitation.id,
            invitation.productId,
            invitation.email,
            invitation.role,
            invitation.passcodeHash,
            invitation.passcodeEncrypted,
            invitation.invitedBy,
            invitation.expiresAt,
            invitation.createdAt,
          ),
      ]),
      limitGuard(
        db,
        '(SELECT count(*) FROM product_members WHERE product_id = ?) + (SELECT count(*) FROM invitations WHERE product_id = ? AND expires_at > ?) > ?',
        productId,
        productId,
        now,
        maxMembers,
      ),
      bumpProductRevision(db, productId),
      ...audits.map((audit) => insertAuditLog(db, audit)),
    ])
    const revision = results[1 + invitations.length * 3 + 1]?.results[0] as
      | { revision: number }
      | undefined
    return { productRevision: revision?.revision ?? 0 }
  },

  findForJoin: async (passcodeHash, email, now) => {
    const row = await db
      .prepare(
        'SELECT invitations.* FROM invitations JOIN products ON products.id = invitations.product_id WHERE invitations.passcode_hash = ? AND invitations.email = ? AND invitations.expires_at > ? AND products.deleted_at IS NULL',
      )
      .bind(passcodeHash, email, now)
      .first<InvitationRow>()
    return row ? toInvitationRecord(row) : null
  },

  countFailures: async (userId, since) =>
    (
      await db
        .prepare('SELECT count(*) AS n FROM passcode_failures WHERE user_id = ? AND failed_at > ?')
        .bind(userId, since)
        .first<{ n: number }>()
    )?.n ?? 0,

  recordFailure: async ({ id, userId, failedAt }) => {
    await db
      .prepare('INSERT INTO passcode_failures (id, user_id, failed_at) VALUES (?, ?, ?)')
      .bind(id, userId, failedAt)
      .run()
  },

  join: async ({ invitation, userId, now, maxMembers, maxProducts, audit }) => {
    const results = await runBatch(db, [
      // The invitation is still there and valid, to a product that isn't deleted.
      db
        .prepare(
          'DELETE FROM invitations WHERE id = ? AND expires_at > ? AND product_id IN (SELECT id FROM products WHERE deleted_at IS NULL)',
        )
        .bind(invitation.id, now),
      staleGuard(db),
      // Already a member: the primary key makes this fail as `duplicate`.
      db
        .prepare(
          'INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)',
        )
        .bind(invitation.productId, userId, invitation.role, now),
      limitGuard(
        db,
        '(SELECT count(*) FROM product_members WHERE product_id = ?) > ?',
        invitation.productId,
        maxMembers,
      ),
      limitGuard(
        db,
        '(SELECT count(*) FROM product_members m JOIN products p ON p.id = m.product_id WHERE m.user_id = ? AND p.deleted_at IS NULL) > ?',
        userId,
        maxProducts,
      ),
      bumpProductRevision(db, invitation.productId),
      db
        .prepare(
          'UPDATE users SET products_revision = products_revision + 1 WHERE id = ? RETURNING products_revision',
        )
        .bind(userId),
      insertAuditLog(db, audit),
    ])
    const product = results[5]?.results[0] as { revision: number } | undefined
    const user = results[6]?.results[0] as { products_revision: number } | undefined
    return {
      productRevision: product?.revision ?? 0,
      productsRevision: user?.products_revision ?? 0,
    }
  },
})
