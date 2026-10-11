import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { InvitationDao, InvitationRecord } from './invitation.interface.ts'
import type { ProductDao } from './product.interface.ts'

/** Access to the store underneath an `InvitationDao`, for arranging and checking the tests. */
export interface InvitationDaoFixture {
  dao: InvitationDao
  products: ProductDao
  /** Adds a membership directly, as joining will. Users u1 (u1@example.com) … u4 exist. */
  addMember: (productId: string, userId: string, role: 'manager' | 'member') => Promise<void>
  markDeleted: (productId: string) => Promise<void>
  countAuditLogs: () => Promise<number>
}

/** Behavior every `InvitationDao` must share. Product p1, owned by u1, is created by the tests. */
export const invitationDaoContract = (setup: () => Promise<InvitationDaoFixture>) => {
  const audit = (id: string): AuditLogRecord => ({
    id,
    productId: 'p1',
    userId: 'u1',
    targetType: 'member',
    action: 'invite',
    summary: 'x',
    createdAt: 1000,
  })

  const arrange = async () => {
    const f = await setup()
    await f.products.create({
      product: {
        id: 'p1',
        name: 'shop',
        target: 'postgresql18',
        createdAt: 1000,
        updatedAt: 1000,
        revision: 1,
        deletedAt: null,
      },
      ownerId: 'u1',
      maxProducts: 20,
      audit: audit('a-product'),
    })
    return f
  }

  const invitation = (id: string, email: string, expiresAt = 9000): InvitationRecord => ({
    id,
    productId: 'p1',
    email,
    role: 'member',
    passcodeHash: `hash-${id}`,
    passcodeEncrypted: `enc-${id}`,
    invitedBy: 'u1',
    expiresAt,
    createdAt: 1000,
  })
  const invite = (
    f: InvitationDaoFixture,
    rows: InvitationRecord[],
    { maxMembers = 10, now = 2000, userId = 'u1' } = {},
  ) =>
    f.dao.create({
      productId: 'p1',
      invitations: rows,
      now,
      maxMembers,
      userId,
      allowedRoles: ['owner', 'manager'],
      audits: rows.map((row) => audit(`a-${row.id}`)),
    })

  test('invites several people at once, bumping the product revision', async () => {
    const f = await arrange()

    expect(
      await invite(f, [invitation('i1', 'a@example.com'), invitation('i2', 'b@example.com')]),
    ).toEqual({ productRevision: 2 })

    expect(await f.dao.findValid('p1', 'i1', 2000)).toEqual(invitation('i1', 'a@example.com'))
    expect(await f.countAuditLogs()).toBe(3)
  })

  test('finds an invitation only while valid, in its product, while the product exists', async () => {
    const f = await arrange()
    await invite(f, [invitation('i1', 'a@example.com', 3000)])

    expect(await f.dao.findValid('p1', 'i1', 2999)).not.toBeNull()
    expect(await f.dao.findValid('p1', 'i1', 3000)).toBeNull()
    expect(await f.dao.findValid('p2', 'i1', 2000)).toBeNull()
    await f.markDeleted('p1')
    expect(await f.dao.findValid('p1', 'i1', 2000)).toBeNull()
  })

  test('re-inviting an email replaces its earlier invitation', async () => {
    const f = await arrange()
    await invite(f, [invitation('i1', 'a@example.com')])

    await invite(f, [invitation('i2', 'a@example.com')])

    expect(await f.dao.findValid('p1', 'i1', 2000)).toBeNull()
    expect(await f.dao.findValid('p1', 'i2', 2000)).not.toBeNull()
  })

  test('refuses to invite a member, changing nothing', async () => {
    const f = await arrange()
    await f.addMember('p1', 'u2', 'member')

    await expect(
      invite(f, [invitation('i1', 'a@example.com'), invitation('i2', 'u2@example.com')]),
    ).rejects.toMatchObject({ code: 'duplicate' })
    expect(await f.dao.findValid('p1', 'i1', 2000)).toBeNull()
    expect(await f.countAuditLogs()).toBe(1)
  })

  test('counts members and valid invitations against the limit, not expired ones', async () => {
    const f = await arrange()
    await f.addMember('p1', 'u2', 'member')
    await invite(f, [invitation('old', 'old@example.com', 1500)], { now: 1000 })

    // Owner + member + 1 invitation = 3 fits; the expired one doesn't count at 2000.
    await invite(f, [invitation('i1', 'a@example.com')], { maxMembers: 3 })
    await expect(
      invite(f, [invitation('i2', 'b@example.com')], { maxMembers: 3 }),
    ).rejects.toMatchObject({ code: 'limit_exceeded' })
    expect(await f.dao.findValid('p1', 'i2', 2000)).toBeNull()
  })

  const join = (
    f: InvitationDaoFixture,
    row: InvitationRecord,
    userId: string,
    { now = 2000, maxMembers = 10, maxProducts = 20 } = {},
  ) =>
    f.dao.join({
      invitation: row,
      userId,
      now,
      maxMembers,
      maxProducts,
      audit: audit(`a-join-${row.id}-${userId}`),
    })

  test('finds an invitation by passcode hash and email only, while valid', async () => {
    const f = await arrange()
    await invite(f, [invitation('i1', 'u2@example.com', 3000)])

    expect(await f.dao.findForJoin('hash-i1', 'u2@example.com', 2000)).toMatchObject({ id: 'i1' })
    expect(await f.dao.findForJoin('hash-i1', 'u3@example.com', 2000)).toBeNull()
    expect(await f.dao.findForJoin('hash-x', 'u2@example.com', 2000)).toBeNull()
    expect(await f.dao.findForJoin('hash-i1', 'u2@example.com', 3000)).toBeNull()
  })

  test('joins: consumes the invitation and adds the member with the revisions', async () => {
    const f = await arrange()
    const row = invitation('i1', 'u2@example.com')
    await invite(f, [row])

    expect(await join(f, row, 'u2')).toEqual({ productRevision: 3, productsRevision: 2 })

    expect(await f.dao.findForJoin('hash-i1', 'u2@example.com', 2000)).toBeNull()
    expect(await f.products.findMembership('p1', 'u2')).toMatchObject({
      role: 'member',
      joinedAt: 2000,
    })
    expect(await f.countAuditLogs()).toBe(3)
  })

  test('refuses a used or expired invitation, changing nothing', async () => {
    const f = await arrange()
    const row = invitation('i1', 'u2@example.com', 3000)
    await invite(f, [row])

    await expect(join(f, row, 'u2', { now: 3000 })).rejects.toMatchObject({ code: 'stale_update' })
    await join(f, row, 'u2')
    await expect(join(f, row, 'u3')).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.products.findMembership('p1', 'u3')).toBeNull()
  })

  test('refuses a user who is already a member', async () => {
    const f = await arrange()
    const row = invitation('i1', 'x@example.com')
    await invite(f, [row])
    await f.addMember('p1', 'u2', 'member')

    await expect(join(f, row, 'u2')).rejects.toMatchObject({ code: 'duplicate' })
    expect(await f.dao.findForJoin('hash-i1', 'x@example.com', 2000)).not.toBeNull()
  })

  test('refuses to join beyond the member or the user’s product limit', async () => {
    const f = await arrange()
    const row = invitation('i1', 'u2@example.com')
    await invite(f, [row])

    await expect(join(f, row, 'u2', { maxMembers: 1 })).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    await expect(join(f, row, 'u2', { maxProducts: 0 })).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    expect(await f.products.findMembership('p1', 'u2')).toBeNull()
  })

  test('counts a user’s failed entries since a time', async () => {
    const f = await arrange()
    await f.dao.recordFailure({ id: 'f1', userId: 'u2', failedAt: 1000 })
    await f.dao.recordFailure({ id: 'f2', userId: 'u2', failedAt: 2000 })
    await f.dao.recordFailure({ id: 'f3', userId: 'u3', failedAt: 2000 })

    expect(await f.dao.countFailures('u2', 1000)).toBe(1)
    expect(await f.dao.countFailures('u2', 0)).toBe(2)
  })

  test('refuses an actor without the role or on a deleted product', async () => {
    const f = await arrange()
    await f.addMember('p1', 'u2', 'member')

    await expect(
      invite(f, [invitation('i1', 'a@example.com')], { userId: 'u2' }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    await f.markDeleted('p1')
    await expect(invite(f, [invitation('i2', 'b@example.com')])).rejects.toMatchObject({
      code: 'stale_update',
    })
  })
}
