import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { ProductDao, ProductRecord, Role } from './product.interface.ts'

/** Access to the store underneath a `ProductDao`, for arranging and checking the contract tests. */
export interface ProductDaoFixture {
  dao: ProductDao
  /** Adds a user (products revision 1). */
  addUser: (id: string) => Promise<void>
  /** Adds a membership directly, as joining will. */
  addMember: (productId: string, userId: string, role: Role) => Promise<void>
  /** Marks a product deleted, as deleting it will. */
  markDeleted: (productId: string) => Promise<void>
  countAuditLogs: () => Promise<number>
  productsRevision: (userId: string) => Promise<number>
}

/**
 * Behavior every `ProductDao` must share, run against the in-memory DAO here and the D1 DAO in the
 * runtime package. `setup` returns a fresh store with users u1, u2 and u3.
 */
export const productDaoContract = (setup: () => Promise<ProductDaoFixture>) => {
  const product = (id: string, name = `product-${id}`): ProductRecord => ({
    id,
    name,
    target: 'postgresql18',
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    deletedAt: null,
  })
  const audit = (id: string, productId: string): AuditLogRecord => ({
    id,
    productId,
    userId: 'u1',
    targetType: 'product',
    action: 'create',
    summary: 'x',
    createdAt: 1000,
  })
  const create = (dao: ProductDao, id: string, name?: string, ownerId = 'u1', maxProducts = 20) =>
    dao.create({ product: product(id, name), ownerId, maxProducts, audit: audit(`a-${id}`, id) })
  const rename = (dao: ProductDao, overrides: Partial<Parameters<ProductDao['rename']>[0]> = {}) =>
    dao.rename({
      productId: 'p1',
      name: 'renamed',
      expectedUpdatedAt: 1000,
      now: 2000,
      userId: 'u1',
      allowedRoles: ['owner', 'manager'],
      audit: audit('a-rename', 'p1'),
      ...overrides,
    })

  test('creates a product owned by its creator, with the audit log and the list revision', async () => {
    const f = await setup()

    expect(await create(f.dao, 'p1')).toEqual({ productsRevision: 2 })

    expect(await f.dao.findMembership('p1', 'u1')).toEqual({
      product: product('p1'),
      role: 'owner',
      joinedAt: 1000,
    })
    expect(await f.dao.findMembership('p1', 'u2')).toBeNull()
    expect(await f.countAuditLogs()).toBe(1)
    expect(await f.dao.findProductsRevision('u1')).toBe(2)
  })

  test('lists a user’s products with the matching revision', async () => {
    const f = await setup()
    await create(f.dao, 'p1')
    await create(f.dao, 'p2', undefined, 'u2')
    await f.addMember('p2', 'u1', 'member')

    const { revision, memberships } = await f.dao.listForUser('u1')

    expect(revision).toBe(2)
    expect(
      memberships
        .map((m) => [m.product.id, m.role])
        .sort(([a], [b]) => String(a).localeCompare(String(b))),
    ).toEqual([
      ['p1', 'owner'],
      ['p2', 'member'],
    ])
  })

  test('reads the product scope with its members, and nothing for a deleted product', async () => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.addMember('p1', 'u2', 'member')

    const scope = await f.dao.findScope('p1')

    expect(scope?.product).toEqual(product('p1'))
    expect(scope?.members.toSorted((a, b) => a.userId.localeCompare(b.userId))).toEqual([
      { userId: 'u1', name: 'u1', role: 'owner', joinedAt: 1000 },
      { userId: 'u2', name: 'u2', role: 'member', joinedAt: 1000 },
    ])
    expect(await f.dao.findScope('missing')).toBeNull()
    await f.markDeleted('p1')
    expect(await f.dao.findScope('p1')).toBeNull()
  })

  test('refuses a name the owner already uses, but not another owner’s or a deleted one', async () => {
    const f = await setup()
    await create(f.dao, 'p1', 'shop')

    await expect(create(f.dao, 'p2', 'shop')).rejects.toMatchObject({ code: 'duplicate' })
    await create(f.dao, 'p3', 'shop', 'u2')
    await f.markDeleted('p1')
    await create(f.dao, 'p4', 'shop')

    expect(await f.countAuditLogs()).toBe(3)
  })

  test('refuses a product beyond the user’s limit, changing nothing', async () => {
    const f = await setup()
    await create(f.dao, 'p1', undefined, 'u1', 2)
    await create(f.dao, 'p2', undefined, 'u1', 2)

    await expect(create(f.dao, 'p3', undefined, 'u1', 2)).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    expect(await f.dao.findMembership('p3', 'u1')).toBeNull()
    expect(await f.productsRevision('u1')).toBe(3)
    expect(await f.countAuditLogs()).toBe(2)
  })

  test('renames with a newer updated_at, bumping every member’s list revision', async () => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.addMember('p1', 'u2', 'member')

    const result = await rename(f.dao)

    expect(result).toEqual({
      product: { ...product('p1', 'renamed'), updatedAt: 2000, revision: 2 },
      productsRevision: 3,
    })
    expect(await f.productsRevision('u2')).toBe(2)
    expect(await f.productsRevision('u3')).toBe(1)
    expect(await f.countAuditLogs()).toBe(2)
  })

  test.each([
    ['a stale updated_at', { expectedUpdatedAt: 999 }],
    ['an actor without an allowed role', { userId: 'u2' }],
    ['an actor who isn’t a member', { userId: 'u3' }],
  ])('refuses a rename with %s, changing nothing', async (_, overrides) => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.addMember('p1', 'u2', 'member')

    await expect(rename(f.dao, overrides)).rejects.toMatchObject({ code: 'stale_update' })
    expect((await f.dao.findMembership('p1', 'u1'))?.product.name).toBe('product-p1')
    expect(await f.productsRevision('u2')).toBe(1)
    expect(await f.countAuditLogs()).toBe(1)
  })

  const remove = (dao: ProductDao, overrides: Partial<Parameters<ProductDao['delete']>[0]> = {}) =>
    dao.delete({
      productId: 'p1',
      expectedUpdatedAt: 1000,
      now: 3000,
      userId: 'u1',
      allowedRoles: ['owner'],
      audit: audit('a-delete', 'p1'),
      ...overrides,
    })

  test('deletes a product: gone for every member, with their list revisions bumped', async () => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.addMember('p1', 'u2', 'manager')

    expect(await remove(f.dao)).toEqual({ productsRevision: 3 })

    expect(await f.dao.findMembership('p1', 'u1')).toBeNull()
    expect(await f.dao.findScope('p1')).toBeNull()
    expect((await f.dao.listForUser('u2')).memberships).toEqual([])
    expect(await f.productsRevision('u2')).toBe(2)
    expect(await f.countAuditLogs()).toBe(2)
  })

  test.each([
    ['a stale updated_at', { expectedUpdatedAt: 999 }],
    ['an actor who isn’t the owner', { userId: 'u2' }],
  ])('refuses a delete with %s, changing nothing', async (_, overrides) => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.addMember('p1', 'u2', 'manager')

    await expect(remove(f.dao, overrides)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.dao.findScope('p1')).not.toBeNull()
    expect(await f.productsRevision('u2')).toBe(1)
    expect(await f.countAuditLogs()).toBe(1)
  })

  test('refuses to rename a deleted product', async () => {
    const f = await setup()
    await create(f.dao, 'p1')
    await f.markDeleted('p1')

    await expect(rename(f.dao)).rejects.toMatchObject({ code: 'stale_update' })
  })

  test('refuses a rename to a name the product’s owner already uses', async () => {
    const f = await setup()
    await create(f.dao, 'p1', 'one', 'u2')
    await create(f.dao, 'p2', 'two', 'u2')
    await f.addMember('p1', 'u1', 'manager')

    await expect(rename(f.dao, { name: 'two' })).rejects.toMatchObject({ code: 'duplicate' })
    // Renaming to its own current name is fine.
    await rename(f.dao, { name: 'one' })
  })
}
