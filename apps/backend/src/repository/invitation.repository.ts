import type { InvitationDao, InvitationRecord } from '../dao/invitation.interface.ts'

/** A pending (仮登録) member as the product scope shows it: no passcode, hashed or encrypted. */
export interface PendingInvitation {
  id: string
  email: string
  role: InvitationRecord['role']
  expiresAt: number
  createdAt: number
}

export interface InvitationRepository {
  /** The stored invitation, passcode ciphertext included, for the service to re-display it. */
  findValid: InvitationDao['findValid']
  create: InvitationDao['create']
  findForJoin: InvitationDao['findForJoin']
  countFailures: InvitationDao['countFailures']
  recordFailure: InvitationDao['recordFailure']
  join: InvitationDao['join']
}

export const toPendingInvitation = (record: InvitationRecord): PendingInvitation => ({
  id: record.id,
  email: record.email,
  role: record.role,
  expiresAt: record.expiresAt,
  createdAt: record.createdAt,
})

export const createInvitationRepository = (dao: InvitationDao): InvitationRepository => ({
  findValid: (productId, invitationId, now) => dao.findValid(productId, invitationId, now),
  create: (input) => dao.create(input),
  findForJoin: (passcodeHash, email, now) => dao.findForJoin(passcodeHash, email, now),
  countFailures: (userId, since) => dao.countFailures(userId, since),
  recordFailure: (failure) => dao.recordFailure(failure),
  join: (input) => dao.join(input),
})
