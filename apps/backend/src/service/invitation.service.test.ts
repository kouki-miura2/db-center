import { LIMITS } from 'utils'
import { afterEach, expect, test, vi } from 'vite-plus/test'

import type { InvitationRecord } from '../dao/invitation.interface.ts'
import { AppError } from '../error.ts'
import type { InvitationRepository } from '../repository/invitation.repository.ts'
import type { Membership, ProductRepository } from '../repository/product.repository.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { createInvitationService } from './invitation.service.ts'
import { hashPasscode } from './passcode.ts'

afterEach(() => {
  vi.useRealTimers()
})

const products = (role: Membership['role'] | null) =>
  ({
    findMembership: async () =>
      role
        ? {
            product: {
              id: 'p1',
              name: 'shop',
              target: 'postgresql18',
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
            role,
            joinedAt: 1,
          }
        : null,
  }) as unknown as ProductRepository

const secrets: SecretBox = {
  encrypt: async (plaintext, purpose, recordId) => `enc(${plaintext}|${purpose}|${recordId})`,
  decrypt: async (ciphertext) => /^enc\(([^|]+)\|/.exec(ciphertext)?.[1] ?? '',
}

const fakeInvitations = (overrides: Partial<InvitationRepository> = {}): InvitationRepository => ({
  findValid: async () => null,
  create: async () => ({ productRevision: 2 }),
  findForJoin: async () => null,
  countFailures: async () => 0,
  recordFailure: async () => {},
  join: async () => ({ productRevision: 3, productsRevision: 4 }),
  ...overrides,
})

const service = (role: Membership['role'] | null, invitations = fakeInvitations()) =>
  createInvitationService({ products: products(role), invitations, secrets })

test('invites several people with one passcode, storing only its hash and ciphertext', async () => {
  vi.useFakeTimers({ now: 1000 })
  const create = vi.fn<InvitationRepository['create']>(async () => ({ productRevision: 2 }))

  const result = await service('owner', fakeInvitations({ create })).invite({
    userId: 'u1',
    productId: 'p1',
    invitees: [
      { email: ' Hanako@Example.com ', role: 'manager' },
      { email: 'taro@example.com', role: 'member' },
    ],
  })

  expect(result.passcode).toMatch(/^[A-Z0-9]{8}$/)
  expect(result.expiresAt).toBe(1000 + LIMITS.invitationHours * 60 * 60 * 1000)
  expect(result.invitations.map((i) => [i.email, i.role])).toEqual([
    ['hanako@example.com', 'manager'],
    ['taro@example.com', 'member'],
  ])
  expect(result.revisions).toEqual({ product: 2 })
  const input = create.mock.calls[0]?.[0]
  const hash = await hashPasscode(result.passcode)
  for (const row of input?.invitations ?? []) {
    expect(row.passcodeHash).toBe(hash)
    expect(row.passcodeEncrypted).toBe(`enc(${result.passcode}|invitation-passcode|${row.id})`)
  }
  expect(input).toMatchObject({ maxMembers: LIMITS.membersPerProduct, allowedRoles: ['owner'] })
  expect(input?.audits.map((a) => a.summary)).toEqual([
    'hanako@example.com（マネージャー）',
    'taro@example.com（メンバー）',
  ])
  expect(JSON.stringify(input?.audits)).not.toContain(result.passcode)
})

test.each([
  ['a manager inviting a manager', 'manager', 'manager', 'forbidden'],
  ['a member inviting anyone', 'member', 'member', 'forbidden'],
  ['a non-member', null, 'member', 'not_found'],
] as const)('refuses %s', async (_, actor, role, code) => {
  const create = vi.fn()

  await expect(
    service(actor, fakeInvitations({ create })).invite({
      userId: 'u1',
      productId: 'p1',
      invitees: [{ email: 'a@example.com', role }],
    }),
  ).rejects.toMatchObject({ code })
  expect(create).not.toHaveBeenCalled()
})

test('lets a manager invite members', async () => {
  const create = vi.fn<InvitationRepository['create']>(async () => ({ productRevision: 2 }))

  await service('manager', fakeInvitations({ create })).invite({
    userId: 'u1',
    productId: 'p1',
    invitees: [{ email: 'a@example.com', role: 'member' }],
  })

  expect(create.mock.calls[0]?.[0].allowedRoles).toEqual(['owner', 'manager'])
})

test('refuses the same email twice in one request', async () => {
  await expect(
    service('owner').invite({
      userId: 'u1',
      productId: 'p1',
      invitees: [
        { email: 'a@example.com', role: 'member' },
        { email: 'A@example.com', role: 'manager' },
      ],
    }),
  ).rejects.toMatchObject({ code: 'invalid_input' })
})

test.each([
  ['duplicate', 'invalid_state', 'すでに参加しているユーザーは招待できません'],
  [
    'limit_exceeded',
    'limit_exceeded',
    `参加者（参加完了と仮登録の合計）は${LIMITS.membersPerProduct}名までです`,
  ],
] as const)('explains a %s conflict', async (from, code, message) => {
  const invitations = fakeInvitations({
    create: async () => {
      throw new AppError(from)
    },
  })

  await expect(
    service('owner', invitations).invite({
      userId: 'u1',
      productId: 'p1',
      invitees: [{ email: 'a@example.com', role: 'member' }],
    }),
  ).rejects.toMatchObject({ code, message })
})

const stored = (role: InvitationRecord['role']): InvitationRecord => ({
  id: 'i1',
  productId: 'p1',
  email: 'a@example.com',
  role,
  passcodeHash: 'hash',
  passcodeEncrypted: 'enc(AB12CD34|invitation-passcode|i1)',
  invitedBy: 'u1',
  expiresAt: 5000,
  createdAt: 1000,
})

test('shows a valid invitation’s passcode again to whoever may invite that role', async () => {
  const invitations = fakeInvitations({ findValid: async () => stored('member') })

  expect(
    await service('manager', invitations).showPasscode({
      userId: 'u1',
      productId: 'p1',
      invitationId: 'i1',
    }),
  ).toEqual({ passcode: 'AB12CD34', expiresAt: 5000 })
})

test('refuses to show a manager invitation to a manager, or an expired one to anyone', async () => {
  const managerInvitation = fakeInvitations({ findValid: async () => stored('manager') })
  const input = { userId: 'u1', productId: 'p1', invitationId: 'i1' }

  await expect(service('manager', managerInvitation).showPasscode(input)).rejects.toMatchObject({
    code: 'forbidden',
  })
  await expect(service('owner').showPasscode(input)).rejects.toMatchObject({ code: 'not_found' })
})

const joinInput = { userId: 'u2', userName: 'はなこ', email: 'A@Example.com', passcode: 'ab12cd34' }

test('joins with a passcode that opens an invitation to the user’s email', async () => {
  const findForJoin = vi.fn<InvitationRepository['findForJoin']>(async () => stored('member'))
  const join = vi.fn<InvitationRepository['join']>(async () => ({
    productRevision: 3,
    productsRevision: 4,
  }))

  const result = await service('member', fakeInvitations({ findForJoin, join })).join(joinInput)

  expect(findForJoin.mock.calls[0]?.slice(0, 2)).toEqual([
    await hashPasscode('AB12CD34'),
    'a@example.com',
  ])
  expect(join.mock.calls[0]?.[0]).toMatchObject({
    userId: 'u2',
    maxMembers: LIMITS.membersPerProduct,
    maxProducts: LIMITS.productsPerUser,
    audit: { targetType: 'member', action: 'join', summary: 'はなこ', productId: 'p1' },
  })
  expect(result).toMatchObject({
    product: { id: 'p1', role: 'member' },
    revisions: { products: 4, product: 3 },
  })
})

test('a wrong passcode records a failure with a message that doesn’t say which part was wrong', async () => {
  const recordFailure = vi.fn<InvitationRepository['recordFailure']>(async () => {})

  await expect(
    service('member', fakeInvitations({ recordFailure })).join(joinInput),
  ).rejects.toMatchObject({
    code: 'invalid_input',
    message: 'パスコードが正しくないか、このアカウント宛ての招待ではありません',
  })
  expect(recordFailure).toHaveBeenCalledTimes(1)
})

test('at the failure limit, refuses entry without even checking the code', async () => {
  vi.useFakeTimers({ now: 10 * 60 * 60 * 1000 })
  const countFailures = vi.fn<InvitationRepository['countFailures']>(
    async () => LIMITS.passcodeFailures,
  )
  const findForJoin = vi.fn()

  await expect(
    service('member', fakeInvitations({ countFailures, findForJoin })).join(joinInput),
  ).rejects.toMatchObject({ code: 'too_many_attempts' })
  expect(countFailures.mock.calls[0]).toEqual([
    'u2',
    10 * 60 * 60 * 1000 - LIMITS.passcodeFailureWindowHours * 60 * 60 * 1000,
  ])
  expect(findForJoin).not.toHaveBeenCalled()
})

test('explains joining a product the user is already in', async () => {
  const invitations = fakeInvitations({
    findForJoin: async () => stored('member'),
    join: async () => {
      throw new AppError('duplicate')
    },
  })

  await expect(service('member', invitations).join(joinInput)).rejects.toMatchObject({
    code: 'invalid_state',
  })
})
