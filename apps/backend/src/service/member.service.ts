import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'
import type { MemberRepository } from '../repository/member.repository.ts'
import type { Membership, ProductRepository } from '../repository/product.repository.ts'
import { allowedRoles, assertAllowed, type Operation } from './permission.ts'
import { requireMembership } from './product.service.ts'

type Revisions = { revisions: { products: number; product: number } }

export interface MemberService {
  changeRole: (input: {
    userId: string
    productId: string
    targetUserId: string
    role: 'manager' | 'member'
  }) => Promise<Revisions>
  transferOwnership: (input: {
    userId: string
    productId: string
    targetUserId: string
  }) => Promise<Revisions>
  removeMember: (input: {
    userId: string
    productId: string
    targetUserId: string
  }) => Promise<Revisions>
  leave: (input: { userId: string; productId: string }) => Promise<Revisions>
}

// Removing a manager is the owner's; a member, owners' and managers' ("総論 > 権限").
const removeOperation = (role: Role): Operation =>
  role === 'manager' ? 'inviteOrRemoveManager' : 'inviteOrRemoveMember'

const toRevisions = ({
  productRevision,
  productsRevision,
}: {
  productRevision: number
  productsRevision: number
}): Revisions => ({ revisions: { products: productsRevision, product: productRevision } })

/** Roles, ownership, removal and leaving ("各論 > プロダクト管理"). */
export const createMemberService = (deps: {
  products: ProductRepository
  members: MemberRepository
}): MemberService => {
  // The target's membership, as the caller (a member) may see it.
  const requireTarget = async (productId: string, targetUserId: string): Promise<Membership> => {
    const target = await deps.products.findMembership(productId, targetUserId)
    if (!target) throw new AppError('not_found')
    return target
  }
  const audit = (
    productId: string,
    userId: string,
    action: string,
    summary: string,
  ): AuditLogRecord => ({
    id: crypto.randomUUID(),
    productId,
    userId,
    targetType: 'member',
    action,
    summary,
    createdAt: Date.now(),
  })
  const nameOf = async (productId: string, userId: string) =>
    (await deps.products.findScope(productId))?.members.find((member) => member.userId === userId)
      ?.name ?? ''

  return {
    changeRole: async ({ userId, productId, targetUserId, role }) => {
      const actor = await requireMembership(deps.products, productId, userId)
      const target = await requireTarget(productId, targetUserId)
      if (target.role === 'owner') {
        throw new AppError('invalid_state', {
          message: 'オーナーのロールは変更できません。オーナーを譲渡してください',
        })
      }
      if (target.role === role) {
        throw new AppError('invalid_input', { fields: { role: 'すでにこのロールです' } })
      }
      const operation: Operation = role === 'manager' ? 'promoteToManager' : 'demoteToMember'
      assertAllowed(actor.role, operation)
      return toRevisions(
        await deps.members.changeRole({
          productId,
          userId,
          allowedRoles: allowedRoles(operation),
          targetUserId,
          from: target.role,
          to: role,
          audit: audit(
            productId,
            userId,
            'update',
            `${await nameOf(productId, targetUserId)}（${role === 'manager' ? 'マネージャー' : 'メンバー'}）`,
          ),
        }),
      )
    },

    transferOwnership: async ({ userId, productId, targetUserId }) => {
      const actor = await requireMembership(deps.products, productId, userId)
      assertAllowed(actor.role, 'transferOwnership')
      if (targetUserId === userId) {
        throw new AppError('invalid_input', { fields: { userId: 'すでにオーナーです' } })
      }
      await requireTarget(productId, targetUserId)
      const result = await deps.members
        .transferOwnership({
          productId,
          userId,
          allowedRoles: allowedRoles('transferOwnership'),
          targetUserId,
          audit: audit(productId, userId, 'transfer', await nameOf(productId, targetUserId)),
        })
        .catch((error: unknown) => {
          if (error instanceof AppError && error.code === 'duplicate') {
            throw new AppError('duplicate', {
              message: '譲渡先のユーザーがオーナーのプロダクトに、同じ名前のものがあります',
            })
          }
          throw error
        })
      return toRevisions(result)
    },

    removeMember: async ({ userId, productId, targetUserId }) => {
      const actor = await requireMembership(deps.products, productId, userId)
      if (targetUserId === userId) {
        throw new AppError('invalid_input', {
          fields: { userId: '自分をプロダクトから外すときは退出してください' },
        })
      }
      const target = await requireTarget(productId, targetUserId)
      if (target.role === 'owner') {
        throw new AppError('invalid_state', { message: 'オーナーは除外できません' })
      }
      const operation = removeOperation(target.role)
      assertAllowed(actor.role, operation)
      return toRevisions(
        await deps.members.remove({
          productId,
          userId,
          allowedRoles: allowedRoles(operation),
          targetUserId,
          targetRoles: [target.role],
          audit: audit(productId, userId, 'remove', await nameOf(productId, targetUserId)),
        }),
      )
    },

    leave: async ({ userId, productId }) => {
      const actor = await requireMembership(deps.products, productId, userId)
      if (actor.role === 'owner') {
        throw new AppError('invalid_state', {
          message: 'オーナーは退出できません。オーナーを譲渡するか、プロダクトを削除してください',
        })
      }
      assertAllowed(actor.role, 'leaveProduct')
      return toRevisions(
        await deps.members.remove({
          productId,
          userId,
          allowedRoles: allowedRoles('leaveProduct'),
          targetUserId: userId,
          targetRoles: allowedRoles('leaveProduct'),
          audit: audit(productId, userId, 'leave', await nameOf(productId, userId)),
        }),
      )
    },
  }
}
