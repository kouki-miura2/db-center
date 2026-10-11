import { expect, test, vi } from 'vite-plus/test'

import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'
import type { MemberRepository } from '../repository/member.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import { createMemberService } from './member.service.ts'

// Product p1: roles by user ID; names are the IDs.
const products = (roles: Record<string, Role>) =>
  ({
    findMembership: async (_: string, userId: string) =>
      roles[userId]
        ? {
            product: {
              id: 'p1',
              name: 'shop',
              target: 'postgresql18',
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
            role: roles[userId],
            joinedAt: 1,
          }
        : null,
    findScope: async () => ({
      members: Object.entries(roles).map(([userId, role]) => ({
        userId,
        name: userId,
        role,
        joinedAt: 1,
      })),
    }),
  }) as unknown as ProductRepository

const result = { productRevision: 5, productsRevision: 6 }
const fakeMembers = (overrides: Partial<MemberRepository> = {}): MemberRepository => ({
  changeRole: vi.fn(async () => result),
  transferOwnership: vi.fn(async () => result),
  remove: vi.fn(async () => result),
  ...overrides,
})

const roles: Record<string, Role> = {
  owner: 'owner',
  manager: 'manager',
  member: 'member',
  other: 'member',
  manager2: 'manager',
}

test('a manager promotes a member; the write expects the role read', async () => {
  const members = fakeMembers()
  const service = createMemberService({ products: products(roles), members })

  expect(
    await service.changeRole({
      userId: 'manager',
      productId: 'p1',
      targetUserId: 'member',
      role: 'manager',
    }),
  ).toEqual({ revisions: { products: 6, product: 5 } })
  expect(vi.mocked(members.changeRole).mock.calls[0]?.[0]).toMatchObject({
    from: 'member',
    to: 'manager',
    allowedRoles: ['owner', 'manager'],
    audit: { targetType: 'member', action: 'update', summary: 'member（マネージャー）' },
  })
})

test.each([
  ['a manager demoting a manager', 'manager', 'manager', 'member', 'forbidden'],
  ['a member promoting a member', 'member', 'other', 'manager', 'forbidden'],
  ['changing the owner’s role', 'owner', 'owner', 'member', 'invalid_state'],
  ['setting the same role', 'owner', 'member', 'member', 'invalid_input'],
  ['a non-member target', 'owner', 'nobody', 'manager', 'not_found'],
] as const)('refuses %s', async (_, userId, targetUserId, role, code) => {
  const members = fakeMembers()
  const service = createMemberService({ products: products(roles), members })

  await expect(
    service.changeRole({ userId, productId: 'p1', targetUserId, role }),
  ).rejects.toMatchObject({
    code,
  })
  expect(members.changeRole).not.toHaveBeenCalled()
})

test('only the owner transfers ownership, and explains a name clash', async () => {
  const clash = fakeMembers({
    transferOwnership: async () => {
      throw new AppError('duplicate')
    },
  })

  await expect(
    createMemberService({ products: products(roles), members: fakeMembers() }).transferOwnership({
      userId: 'manager',
      productId: 'p1',
      targetUserId: 'member',
    }),
  ).rejects.toMatchObject({ code: 'forbidden' })
  await expect(
    createMemberService({ products: products(roles), members: clash }).transferOwnership({
      userId: 'owner',
      productId: 'p1',
      targetUserId: 'member',
    }),
  ).rejects.toMatchObject({
    code: 'duplicate',
    message: '譲渡先のユーザーがオーナーのプロダクトに、同じ名前のものがあります',
  })
})

test.each([
  ['the owner removes a manager', 'owner', 'manager', null],
  ['a manager removes a member', 'manager', 'member', null],
  ['a manager can’t remove a manager', 'manager', 'manager2', 'forbidden'],
  ['nobody removes themself (they leave instead)', 'manager', 'manager', 'invalid_input'],
  ['a member can’t remove anyone', 'member', 'other', 'forbidden'],
  ['nobody removes the owner', 'manager', 'owner', 'invalid_state'],
] as const)('%s', async (_, userId, targetUserId, code) => {
  const members = fakeMembers()
  const service = createMemberService({ products: products(roles), members })
  const removal = service.removeMember({ userId, productId: 'p1', targetUserId })

  if (code) {
    await expect(removal).rejects.toMatchObject({ code })
  } else {
    await removal
    expect(vi.mocked(members.remove).mock.calls[0]?.[0]).toMatchObject({
      targetRoles: [roles[targetUserId]],
      audit: { action: 'remove', summary: targetUserId },
    })
  }
})

test('managers and members leave; the owner can’t', async () => {
  const members = fakeMembers()
  const service = createMemberService({ products: products(roles), members })

  await service.leave({ userId: 'member', productId: 'p1' })
  expect(vi.mocked(members.remove).mock.calls[0]?.[0]).toMatchObject({
    userId: 'member',
    targetUserId: 'member',
    audit: { action: 'leave' },
  })
  await expect(service.leave({ userId: 'owner', productId: 'p1' })).rejects.toMatchObject({
    code: 'invalid_state',
  })
})
