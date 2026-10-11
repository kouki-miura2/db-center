import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { MemberDao } from './member.interface.ts'
import type { ProductDao, Role } from './product.interface.ts'

/** Access to the store underneath a `MemberDao`, for arranging and checking the tests. */
export interface MemberDaoFixture {
  dao: MemberDao
  products: ProductDao
  /** Adds a membership directly, as joining will. Users u1 … u3 exist. */
  addMember: (productId: string, userId: string, role: 'manager' | 'member') => Promise<void>
  productsRevision: (userId: string) => Promise<number>
  countAuditLogs: () => Promise<number>
}

/**
 * Behavior every `MemberDao` must share. Product p1 ("shop") is owned by u1, with u2 as a manager
 * and u3 as a member.
 */
export const memberDaoContract = (setup: () => Promise<MemberDaoFixture>) => {
  const audit = (id: string): AuditLogRecord => ({
    id,
    productId: 'p1',
    userId: 'u1',
    targetType: 'member',
    action: 'update',
    summary: 'x',
    createdAt: 1000,
  })
  const createProduct = (f: MemberDaoFixture, id: string, name: string, ownerId: string) =>
    f.products.create({
      product: {
        id,
        name,
        target: 'postgresql18',
        createdAt: 1000,
        updatedAt: 1000,
        revision: 1,
        deletedAt: null,
      },
      ownerId,
      maxProducts: 20,
      audit: audit(`a-${id}`),
    })
  const arrange = async () => {
    const f = await setup()
    await createProduct(f, 'p1', 'shop', 'u1')
    await f.addMember('p1', 'u2', 'manager')
    await f.addMember('p1', 'u3', 'member')
    return f
  }
  const roleOf = async (f: MemberDaoFixture, userId: string) =>
    (await f.products.findMembership('p1', userId))?.role ?? null
  let auditId = 0
  const write = (userId: string, allowedRoles: Role[]) => ({
    productId: 'p1',
    userId,
    allowedRoles,
    audit: audit(`a-write-${++auditId}`),
  })

  test('changes a role, bumping the product and the member’s list revisions', async () => {
    const f = await arrange()

    const result = await f.dao.changeRole({
      ...write('u1', ['owner', 'manager']),
      targetUserId: 'u3',
      from: 'member',
      to: 'manager',
    })

    expect(result).toEqual({ productRevision: 2, productsRevision: 2 })
    expect(await roleOf(f, 'u3')).toBe('manager')
    expect(await f.productsRevision('u3')).toBe(2)
  })

  test('refuses a role change when the role is no longer the one read', async () => {
    const f = await arrange()

    await expect(
      f.dao.changeRole({
        ...write('u1', ['owner']),
        targetUserId: 'u2',
        from: 'member',
        to: 'manager',
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.productsRevision('u2')).toBe(1)
  })

  test('transfers ownership: the old owner becomes a manager', async () => {
    const f = await arrange()

    const result = await f.dao.transferOwnership({ ...write('u1', ['owner']), targetUserId: 'u3' })

    expect(result.productsRevision).toBe(3)
    expect(await roleOf(f, 'u1')).toBe('manager')
    expect(await roleOf(f, 'u3')).toBe('owner')
    expect(await f.productsRevision('u3')).toBe(2)
  })

  test('refuses a transfer when the new owner already owns a product of that name', async () => {
    const f = await arrange()
    await createProduct(f, 'p2', 'shop', 'u3')

    await expect(
      f.dao.transferOwnership({ ...write('u1', ['owner']), targetUserId: 'u3' }),
    ).rejects.toMatchObject({ code: 'duplicate' })
    expect(await roleOf(f, 'u1')).toBe('owner')
    expect(await roleOf(f, 'u3')).toBe('member')
  })

  test('refuses a transfer by someone who isn’t the owner, or to a non-member', async () => {
    const f = await arrange()

    await expect(
      f.dao.transferOwnership({ ...write('u2', ['owner']), targetUserId: 'u3' }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    await expect(
      f.dao.transferOwnership({ ...write('u1', ['owner']), targetUserId: 'u9' }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await roleOf(f, 'u1')).toBe('owner')
  })

  test('removes a member, who loses the product from their list', async () => {
    const f = await arrange()

    await f.dao.remove({
      ...write('u2', ['owner', 'manager']),
      targetUserId: 'u3',
      targetRoles: ['member'],
    })

    expect(await roleOf(f, 'u3')).toBeNull()
    expect((await f.products.listForUser('u3')).memberships).toEqual([])
    expect(await f.productsRevision('u3')).toBe(2)
    expect(await f.countAuditLogs()).toBe(2)
  })

  test('refuses to remove someone whose role isn’t one of the expected', async () => {
    const f = await arrange()

    await expect(
      f.dao.remove({
        ...write('u2', ['owner', 'manager']),
        targetUserId: 'u1',
        targetRoles: ['member'],
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    expect(await roleOf(f, 'u1')).toBe('owner')
  })

  test('lets a member leave', async () => {
    const f = await arrange()

    const result = await f.dao.remove({
      ...write('u3', ['manager', 'member']),
      targetUserId: 'u3',
      targetRoles: ['manager', 'member'],
    })

    expect(result.productsRevision).toBe(2)
    expect(await roleOf(f, 'u3')).toBeNull()
  })
}
