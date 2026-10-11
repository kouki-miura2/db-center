import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { DatabaseDao, DatabaseRecord, InitialSchema } from './database.interface.ts'
import type { ProductDao } from './product.interface.ts'

/** Access to the store underneath a `DatabaseDao`, for arranging and checking the tests. */
export interface DatabaseDaoFixture {
  dao: DatabaseDao
  products: ProductDao
  /** Adds a membership directly, as joining will. */
  addMember: (productId: string, userId: string, role: 'manager' | 'member') => Promise<void>
  markProductDeleted: (productId: string) => Promise<void>
  countAuditLogs: () => Promise<number>
  /** Physical names of a version's objects. */
  objectNames: (versionId: string) => Promise<string[]>
  definitionBytes: (versionId: string) => Promise<number>
}

/**
 * Behavior every `DatabaseDao` must share. `setup` returns a fresh store with users u1 and u2;
 * product p1, owned by u1, is created by the tests.
 */
export const databaseDaoContract = (setup: () => Promise<DatabaseDaoFixture>) => {
  const audit = (id: string): AuditLogRecord => ({
    id,
    productId: 'p1',
    userId: 'u1',
    targetType: 'database',
    action: 'create',
    summary: 'x',
    createdAt: 1000,
  })
  const base = { userId: 'u1', allowedRoles: ['owner' as const, 'manager' as const] }

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

  const database = (id: string, name = `db_${id}`): DatabaseRecord => ({
    id,
    productId: 'p1',
    name,
    description: '説明',
    createdAt: 1000,
    updatedAt: 1000,
    revision: 1,
    deletedAt: null,
  })
  const publicSchema = (id: string): InitialSchema => ({
    id: `o-${id}`,
    objectKey: `k-${id}`,
    name: 'public',
    definition: '{"comment":"標準"}',
  })
  const create = (
    f: DatabaseDaoFixture,
    id: string,
    {
      name,
      maxDatabases = 20,
      schema = true,
    }: { name?: string; maxDatabases?: number; schema?: boolean } = {},
  ) =>
    f.dao.create({
      ...base,
      database: database(id, name),
      versionId: `v-${id}`,
      schema: schema ? publicSchema(id) : null,
      maxDatabases,
      audit: audit(`a-${id}`),
    })

  test('creates a database with v1 (editing) holding its schema, listed in the product scope', async () => {
    const f = await arrange()

    expect(await create(f, 'd1')).toEqual({ productRevision: 2 })
    expect(await create(f, 'd2', { schema: false })).toEqual({ productRevision: 3 })

    expect(await f.dao.findById('p1', 'd1')).toEqual(database('d1'))
    const scope = await f.products.findScope('p1')
    expect(scope?.databases.toSorted((a, b) => a.database.id.localeCompare(b.database.id))).toEqual(
      [
        {
          database: database('d1'),
          latestVersion: {
            id: 'v-d1',
            number: 1,
            status: 'editing',
            schemaCount: 1,
            tableCount: 0,
          },
          latestFinalVersion: null,
        },
        {
          database: database('d2'),
          latestVersion: {
            id: 'v-d2',
            number: 1,
            status: 'editing',
            schemaCount: 0,
            tableCount: 0,
          },
          latestFinalVersion: null,
        },
      ],
    )
    expect(await f.objectNames('v-d1')).toEqual(['public'])
    expect(await f.objectNames('v-d2')).toEqual([])
    // "標準" is 6 bytes in UTF-8.
    expect(await f.definitionBytes('v-d1')).toBe('{"comment":""}'.length + 6)
    expect(await f.countAuditLogs()).toBe(3)
  })

  test('reads the database scope: the database, its common columns and its versions', async () => {
    const f = await arrange()
    await create(f, 'd1')

    expect(await f.dao.findScope('p1', 'd1')).toEqual({
      database: database('d1'),
      commonColumns: null,
      versions: [
        {
          id: 'v-d1',
          databaseId: 'd1',
          number: 1,
          status: 'editing',
          sourceVersionId: null,
          memo: null,
          provisionalAt: null,
          finalizedAt: null,
          createdAt: 1000,
          updatedAt: 1000,
          revision: 1,
          compactedRevision: 1,
          schemaCount: 1,
          tableCount: 0,
          definitionBytes: '{"comment":""}'.length + 6,
        },
      ],
    })
    expect(await f.dao.findScope('other', 'd1')).toBeNull()
    expect(await f.dao.findScope('p1', 'missing')).toBeNull()
    await f.markProductDeleted('p1')
    expect(await f.dao.findScope('p1', 'd1')).toBeNull()
  })

  test('refuses a name in use in the product, changing nothing', async () => {
    const f = await arrange()
    await create(f, 'd1', { name: 'main' })

    await expect(create(f, 'd2', { name: 'main' })).rejects.toMatchObject({ code: 'duplicate' })
    expect(await f.dao.findById('p1', 'd2')).toBeNull()
    expect(await f.objectNames('v-d2')).toEqual([])
    expect((await f.products.findScope('p1'))?.product.revision).toBe(2)
    expect(await f.countAuditLogs()).toBe(2)
  })

  test('refuses a database beyond the limit, not counting deleted ones', async () => {
    const f = await arrange()
    await create(f, 'd1', { maxDatabases: 1 })

    await expect(create(f, 'd2', { maxDatabases: 1 })).rejects.toMatchObject({
      code: 'limit_exceeded',
    })
    expect(await f.dao.findById('p1', 'd2')).toBeNull()

    await f.dao.delete({
      ...base,
      productId: 'p1',
      databaseId: 'd1',
      expectedUpdatedAt: 1000,
      now: 2000,
      audit: audit('a-delete'),
    })
    await expect(create(f, 'd2', { maxDatabases: 1 })).resolves.toBeDefined()
  })

  test('refuses writes by a member or on a deleted product', async () => {
    const f = await arrange()
    await f.addMember('p1', 'u2', 'member')

    await expect(
      f.dao.create({
        ...base,
        userId: 'u2',
        database: database('d1'),
        versionId: 'v-d1',
        schema: null,
        maxDatabases: 20,
        audit: audit('a'),
      }),
    ).rejects.toMatchObject({ code: 'stale_update' })
    await create(f, 'd2')
    await f.markProductDeleted('p1')
    await expect(create(f, 'd3')).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.dao.findById('p1', 'd2')).toBeNull()
  })

  const update = (
    f: DatabaseDaoFixture,
    overrides: Partial<Parameters<DatabaseDao['update']>[0]> = {},
  ) =>
    f.dao.update({
      ...base,
      productId: 'p1',
      databaseId: 'd1',
      name: 'renamed',
      description: null,
      expectedUpdatedAt: 1000,
      now: 2000,
      audit: audit(`a-update-${overrides.now ?? 2000}`),
      ...overrides,
    })

  test('renames a database with optimistic locking, bumping its revision', async () => {
    const f = await arrange()
    await create(f, 'd1')
    await create(f, 'd2', { name: 'taken' })

    await expect(update(f, { expectedUpdatedAt: 999 })).rejects.toMatchObject({
      code: 'stale_update',
    })
    await expect(update(f, { name: 'taken' })).rejects.toMatchObject({ code: 'duplicate' })
    await expect(update(f, { productId: 'other' })).rejects.toMatchObject({ code: 'stale_update' })
    expect((await f.dao.findById('p1', 'd1'))?.name).toBe('db_d1')

    expect(await update(f)).toEqual({
      database: {
        ...database('d1'),
        name: 'renamed',
        description: null,
        updatedAt: 2000,
        revision: 2,
      },
      productRevision: 4,
    })
    // Same millisecond: updated_at still grows.
    const again = await update(f, {
      name: 'again',
      expectedUpdatedAt: 2000,
      now: 2000,
      audit: audit('a-again'),
    })
    expect(again.database.updatedAt).toBe(2001)
  })

  test('deletes a database: gone, its name free again', async () => {
    const f = await arrange()
    await create(f, 'd1', { name: 'main' })
    const remove = (expectedUpdatedAt: number) =>
      f.dao.delete({
        ...base,
        productId: 'p1',
        databaseId: 'd1',
        expectedUpdatedAt,
        now: 2000,
        audit: audit(`a-delete-${expectedUpdatedAt}`),
      })

    await expect(remove(999)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await remove(1000)).toEqual({ productRevision: 3 })
    await expect(remove(2000)).rejects.toMatchObject({ code: 'stale_update' })
    expect(await f.dao.findById('p1', 'd1')).toBeNull()
    expect(await f.dao.findScope('p1', 'd1')).toBeNull()
    expect((await f.products.findScope('p1'))?.databases).toEqual([])
    await expect(create(f, 'd2', { name: 'main' })).resolves.toBeDefined()
    await expect(update(f, { databaseId: 'd1', expectedUpdatedAt: 2000 })).rejects.toMatchObject({
      code: 'stale_update',
    })
  })
}
