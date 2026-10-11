import type { AuditLogRecord } from './audit-log.interface.ts'
import type { Role } from './product.interface.ts'

/** One `invitations` row: a pending (仮登録) member. Emails are stored lowercased. */
export interface InvitationRecord {
  id: string
  productId: string
  email: string
  role: 'manager' | 'member'
  passcodeHash: string
  passcodeEncrypted: string
  invitedBy: string
  expiresAt: number
  createdAt: number
}

export interface InvitationDao {
  /** An invitation of a product that isn't deleted, still valid at `now`, or null. */
  findValid: (
    productId: string,
    invitationId: string,
    now: number,
  ) => Promise<InvitationRecord | null>
  /**
   * Invites everyone in `invitations` at once, replacing any earlier invitation of the same email
   * to the product, with one audit log entry each, and bumps the product revision. Throws
   * `duplicate` if one of the emails is already a member's, `limit_exceeded` if members plus
   * invitations still valid at `now` would exceed `maxMembers`, and `stale_update` if `userId` no
   * longer has one of `allowedRoles` or the product was deleted.
   */
  create: (input: {
    productId: string
    invitations: InvitationRecord[]
    now: number
    maxMembers: number
    userId: string
    allowedRoles: Role[]
    audits: AuditLogRecord[]
  }) => Promise<{ productRevision: number }>
}
