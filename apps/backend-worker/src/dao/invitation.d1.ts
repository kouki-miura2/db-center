import type { InvitationDao, InvitationRecord } from 'backend/src/dao/invitation.interface.ts'

import { guard, insertAuditLog, limitGuard, runBatch } from './batch.ts'
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
})
