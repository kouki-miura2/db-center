import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { ConnectionDao, ConnectionRecord } from './connection.interface.ts'
import type { ProductDao } from './product.interface.ts'

/** Access to the store underneath a `ConnectionDao`, for arranging and checking the tests. */
export interface ConnectionDaoFixture {
  dao: ConnectionDao
  products: ProductDao
  /** Adds a membership directly, as joining will. */
  addMember: (productId: string, userId: string, role: 'manager' | 'member') => Promise<void>
  markDeleted: (productId: string) => Promise<void>
  countAuditLogs: () => Promise<number>
}

/**
 * Behavior every `ConnectionDao` must share. `setup` returns a fresh store with users u1 and u2;
 * product p1, owned by u1, is created by the tests.
 */
export const connectionDaoContract = (setup: () => Promise<ConnectionDaoFixture>) => {
  const audit = (id: string): AuditLogRecord => ({
    id,
    productId: 'p1',
    userId: 'u1',
    targetType: 'connection',
    action: 'create',
    summary: 'x',
    createdAt: 1000,
  })
  const base = { userId: 'u1', allowedRoles: ['owner', 'manager'] as const }

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

  const connection = (id: string): Omit<ConnectionRecord, 'sortOrder'> => ({
    id,
    productId: 'p1',
    name: `conn-${id}`,
    connectionString: 'postgresql://app@db.example.com/ec',
    passwordEncrypted: 'v1.cipher',
    createdAt: 1000,
    updatedAt: 1000,
  })
  const create = (f: ConnectionDaoFixture, id: string, maxConnections = 10) =>
    f.dao.create({
      ...base,
      allowedRoles: [...base.allowedRoles],
      connection: connection(id),
      maxConnections,
      audit: audit(`a-${id}`),
    })

  test('adds connections after the others, bumping the product revision', async () => {
    const f = await arrange()

    const first = await create(f, 'c1')
    const second = await create(f, 'c2')

    expect(first).toEqual({ connection: { ...connection('c1'), sortOrder: 1 }, productRevision: 2 })
    expect(second.connection.sortOrder).toBe(2)
    expect(second.productRevision).toBe(3)
    expect(await f.dao.findById('p1', 'c1')).toEqual({ ...connection('c1'), sortOrder: 1 })
    expect(await f.dao.findById('other', 'c1')).toBeNull()
    expect(await f.countAuditLogs()).toBe(3)
  })

  test('refuses a connection beyond the limit, changing nothing', async () => {
    const f = await arrange()
    await create(f, 'c1', 1)

    await expect(create(f, 'c2', 1)).rejects.toMatchObject({ code: 'limit_exceeded' })
    expect(await f.dao.findById('p1', 'c2')).toBeNull()
    expect((await f.products.findScope('p1'))?.product.revision).toBe(2)
  })

  test('refuses writes by a member or on a deleted product', async () => {
    const f = await arrange()
    await f.addMember('p1', 'u2', 'member')

    await expect(
      f.dao.create({
        ...base,
        allowedRoles: [...base.allowedRoles],
        userId: 'u2',
        connection: connection('c1'),
        maxConnections: 10,
        audit: audit('a'),
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    await f.markDeleted('p1')
    await expect(create(f, 'c2')).rejects.toMatchObject({ code: 'stale_update' })
  })

  const update = (
    f: ConnectionDaoFixture,
    overrides: Partial<Parameters<ConnectionDao['update']>[0]> = {},
  ) =>
    f.dao.update({
      ...base,
      allowedRoles: [...base.allowedRoles],
      productId: 'p1',
      connectionId: 'c1',
      name: 'renamed',
      connectionString: 'postgresql://app@db2.example.com/ec',
      passwordEncrypted: undefined,
      expectedUpdatedAt: 1000,
      now: 2000,
      ...overrides,
      audit: audit(`a-update-${overrides.now ?? 2000}`),
    })

  test('updates a connection, keeping, replacing or removing its password', async () => {
    const f = await arrange()
    await create(f, 'c1')

    const kept = await update(f)
    expect(kept.connection).toMatchObject({
      name: 'renamed',
      connectionString: 'postgresql://app@db2.example.com/ec',
      passwordEncrypted: 'v1.cipher',
      updatedAt: 2000,
    })
    const replaced = await update(f, {
      passwordEncrypted: 'v1.new',
      expectedUpdatedAt: 2000,
      now: 3000,
    })
    expect(replaced.connection.passwordEncrypted).toBe('v1.new')
    const removed = await update(f, { passwordEncrypted: null, expectedUpdatedAt: 3000, now: 4000 })
    expect(removed.connection.passwordEncrypted).toBeNull()
  })

  test('refuses a stale update or one for another product’s connection', async () => {
    const f = await arrange()
    await create(f, 'c1')

    await expect(update(f, { expectedUpdatedAt: 999 })).rejects.toMatchObject({
      code: 'stale_update',
    })
    await expect(update(f, { connectionId: 'missing' })).rejects.toMatchObject({
      code: 'stale_update',
    })
    expect((await f.dao.findById('p1', 'c1'))?.name).toBe('conn-c1')
  })

  test('deletes a connection with optimistic locking', async () => {
    const f = await arrange()
    await create(f, 'c1')
    const remove = (expectedUpdatedAt: number) =>
      f.dao.delete({
        ...base,
        allowedRoles: [...base.allowedRoles],
        productId: 'p1',
        connectionId: 'c1',
        expectedUpdatedAt,
        audit: audit('a-delete'),
      })

    await expect(remove(999)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await remove(1000)).toEqual({ productRevision: 3 })
    expect(await f.dao.findById('p1', 'c1')).toBeNull()
  })

  test('reorders exactly the product’s connections at the expected revision', async () => {
    const f = await arrange()
    await create(f, 'c1')
    await create(f, 'c2')
    await create(f, 'c3')
    const reorder = (connectionIds: string[], expectedRevision = 4) =>
      f.dao.reorder({
        ...base,
        allowedRoles: [...base.allowedRoles],
        productId: 'p1',
        connectionIds,
        expectedRevision,
        audit: audit('a-reorder'),
      })

    for (const bad of [
      ['c3', 'c1'],
      ['c3', 'c1', 'c2', 'c9'],
      ['c3', 'c1', 'c1'],
    ]) {
      await expect(reorder(bad)).rejects.toMatchObject({ code: 'stale_update' })
    }
    await expect(reorder(['c3', 'c1', 'c2'], 3)).rejects.toMatchObject({ code: 'stale_update' })
    expect((await f.dao.findById('p1', 'c1'))?.sortOrder).toBe(1)

    expect(await reorder(['c3', 'c1', 'c2'])).toEqual({ productRevision: 5 })
    expect((await f.dao.findById('p1', 'c3'))?.sortOrder).toBe(1)
    expect((await f.dao.findById('p1', 'c2'))?.sortOrder).toBe(3)
  })
}
