import { LIMITS } from 'utils'

import type { InvitationRecord } from '../dao/invitation.interface.ts'
import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'
import {
  type InvitationRepository,
  type PendingInvitation,
  toPendingInvitation,
} from '../repository/invitation.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { createPasscode, hashPasscode } from './passcode.ts'
import { allowedRoles, assertAllowed, type Operation } from './permission.ts'
import type { ProductListItemView } from './product.service.ts'
import { requireMembership } from './product.service.ts'

type InvitedRole = InvitationRecord['role']

export interface InvitationService {
  /**
   * Invites everyone at once with one shared passcode, returned here for the inviter to pass on.
   * Re-inviting a pending email replaces its invitation.
   */
  invite: (input: {
    userId: string
    productId: string
    invitees: { email: string; role: InvitedRole }[]
  }) => Promise<{
    passcode: string
    expiresAt: number
    invitations: PendingInvitation[]
    revisions: { product: number }
  }>
  /** Shows the passcode of an invitation again while it's valid. */
  showPasscode: (input: {
    userId: string
    productId: string
    invitationId: string
  }) => Promise<{ passcode: string; expiresAt: number }>
  /**
   * Joins with a passcode: it must open a valid invitation to the user's own email. Failures are
   * counted per user; at the limit, entry is refused until the window passes.
   */
  join: (input: { userId: string; userName: string; email: string; passcode: string }) => Promise<{
    product: ProductListItemView
    revisions: { products: number; product: number }
  }>
}

const HOUR_MS = 60 * 60 * 1000

// The same message whether the code is wrong or the invitation is for someone else.
const WRONG_PASSCODE = 'パスコードが正しくないか、このアカウント宛ての招待ではありません'
const ROLE_LABEL: Record<InvitedRole, string> = { manager: 'マネージャー', member: 'メンバー' }

// Managers can be invited (and removed) by the owner only; members by owners and managers.
const inviteOperation = (role: InvitedRole): Operation =>
  role === 'manager' ? 'inviteOrRemoveManager' : 'inviteOrRemoveMember'

const assertMayInvite = (actorRole: Role, roles: InvitedRole[]) => {
  for (const role of roles) assertAllowed(actorRole, inviteOperation(role))
}

/** Invitations to a product ("各論 > プロダクト管理 > 招待"). */
export const createInvitationService = (deps: {
  products: ProductRepository
  invitations: InvitationRepository
  secrets: SecretBox
}): InvitationService => ({
  invite: async ({ userId, productId, invitees }) => {
    const emails = invitees.map((invitee) => invitee.email.trim().toLowerCase())
    if (new Set(emails).size !== emails.length) {
      throw new AppError('invalid_input', {
        fields: { invitees: '同じメールアドレスが複数あります' },
      })
    }
    const { role } = await requireMembership(deps.products, productId, userId)
    const roles = invitees.map((invitee) => invitee.role)
    assertMayInvite(role, roles)
    const now = Date.now()
    const expiresAt = now + LIMITS.invitationHours * HOUR_MS
    const passcode = createPasscode()
    const passcodeHash = await hashPasscode(passcode)
    const invitations: InvitationRecord[] = await Promise.all(
      invitees.map(async (invitee, index) => {
        const id = crypto.randomUUID()
        return {
          id,
          productId,
          email: emails[index] as string,
          role: invitee.role,
          passcodeHash,
          passcodeEncrypted: await deps.secrets.encrypt(passcode, 'invitation-passcode', id),
          invitedBy: userId,
          expiresAt,
          createdAt: now,
        }
      }),
    )
    const { productRevision } = await deps.invitations
      .create({
        productId,
        invitations,
        now,
        maxMembers: LIMITS.membersPerProduct,
        userId,
        // The role must still allow every invited role when written.
        allowedRoles: roles.includes('manager')
          ? allowedRoles('inviteOrRemoveManager')
          : allowedRoles('inviteOrRemoveMember'),
        audits: invitations.map((invitation) => ({
          id: crypto.randomUUID(),
          productId,
          userId,
          targetType: 'member',
          action: 'invite',
          summary: `${invitation.email}（${ROLE_LABEL[invitation.role]}）`,
          createdAt: now,
        })),
      })
      .catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'duplicate') {
          throw new AppError('invalid_state', {
            message: 'すでに参加しているユーザーは招待できません',
          })
        }
        if (error instanceof AppError && error.code === 'limit_exceeded') {
          throw new AppError('limit_exceeded', {
            message: `参加者（参加完了と仮登録の合計）は${LIMITS.membersPerProduct}名までです`,
          })
        }
        throw error
      })
    return {
      passcode,
      expiresAt,
      invitations: invitations.map(toPendingInvitation),
      revisions: { product: productRevision },
    }
  },

  showPasscode: async ({ userId, productId, invitationId }) => {
    const { role } = await requireMembership(deps.products, productId, userId)
    const invitation = await deps.invitations.findValid(productId, invitationId, Date.now())
    if (!invitation) throw new AppError('not_found')
    assertMayInvite(role, [invitation.role])
    return {
      passcode: await deps.secrets.decrypt(
        invitation.passcodeEncrypted,
        'invitation-passcode',
        invitation.id,
      ),
      expiresAt: invitation.expiresAt,
    }
  },

  join: async ({ userId, userName, email, passcode }) => {
    const now = Date.now()
    const since = now - LIMITS.passcodeFailureWindowHours * HOUR_MS
    if ((await deps.invitations.countFailures(userId, since)) >= LIMITS.passcodeFailures) {
      throw new AppError('too_many_attempts')
    }
    const invitation = await deps.invitations.findForJoin(
      await hashPasscode(passcode),
      email.toLowerCase(),
      now,
    )
    if (!invitation) {
      await deps.invitations.recordFailure({ id: crypto.randomUUID(), userId, failedAt: now })
      throw new AppError('invalid_input', { message: WRONG_PASSCODE })
    }
    const { productRevision, productsRevision } = await deps.invitations
      .join({
        invitation,
        userId,
        now,
        maxMembers: LIMITS.membersPerProduct,
        maxProducts: LIMITS.productsPerUser,
        audit: {
          id: crypto.randomUUID(),
          productId: invitation.productId,
          userId,
          targetType: 'member',
          action: 'join',
          summary: userName,
          createdAt: now,
        },
      })
      .catch((error: unknown) => {
        if (error instanceof AppError && error.code === 'duplicate') {
          throw new AppError('invalid_state', { message: 'すでにこのプロダクトに参加しています' })
        }
        if (error instanceof AppError && error.code === 'limit_exceeded') {
          throw new AppError('limit_exceeded', {
            message: `参加できるプロダクトは${LIMITS.productsPerUser}件、1プロダクトの参加者は${LIMITS.membersPerProduct}名までです`,
          })
        }
        throw error
      })
    const membership = await requireMembership(deps.products, invitation.productId, userId)
    return {
      product: {
        id: membership.product.id,
        name: membership.product.name,
        target: membership.product.target,
        role: membership.role,
        createdAt: membership.product.createdAt,
        joinedAt: membership.joinedAt,
        updatedAt: membership.product.updatedAt,
      },
      revisions: { products: productsRevision, product: productRevision },
    }
  },
})
