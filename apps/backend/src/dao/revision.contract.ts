import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { DatabaseDao } from './database.interface.ts'
import type { ProductDao } from './product.interface.ts'
import type { RevisionDao } from './revision.interface.ts'

/** Access to the store underneath a `RevisionDao`, for arranging the tests. */
export interface RevisionDaoFixture {
  dao: RevisionDao
  products: ProductDao
  databases: DatabaseDao
  markProductDeleted: (productId: string) => Promise<void>
}

/**
 * Behavior every `RevisionDao` must share. `setup` returns a fresh store with users u1 and u2;
 * the tests create p1 (u1's, with database d1 and version v1) and p2 (u2's, with d2 and v2).
 */
export const revisionDaoContract = (setup: () => Promise<RevisionDaoFixture>) => {
  const audit = (id: string, productId: string): AuditLogRecord => ({
    id,
    productId,
    userId: 'u1',
    targetType: 'product',
    action: 'create',
    summary: 'x',
    createdAt: 1000,
  })

  const arrange = async () => {
    const f = await setup()
    for (const [n, owner] of [
      ['1', 'u1'],
      ['2', 'u2'],
    ] as const) {
      await f.products.create({
        product: {
          id: `p${n}`,
          name: 'shop',
          target: 'postgresql18',
          createdAt: 1000,
          updatedAt: 1000,
          revision: 1,
          deletedAt: null,
        },
        ownerId: owner,
        maxProducts: 20,
        audit: audit(`a-p${n}`, `p${n}`),
      })
      await f.databases.create({
        userId: owner,
        allowedRoles: ['owner'],
        database: {
          id: `d${n}`,
          productId: `p${n}`,
          name: 'main',
          description: null,
          createdAt: 1000,
          updatedAt: 1000,
          revision: 1,
          deletedAt: null,
        },
        versionId: `v${n}`,
        schema: null,
        maxDatabases: 20,
        audit: audit(`a-d${n}`, `p${n}`),
      })
    }
    return f
  }

  const ask = {
    userId: 'u1',
    productList: true,
    productIds: ['p1', 'p2', 'missing'],
    databaseIds: ['d1', 'd2', 'missing'],
    versionIds: ['v1', 'v2', 'missing'],
  }

  test('returns the revisions of the user’s scopes only', async () => {
    const f = await arrange()

    expect(await f.dao.findRevisions(ask)).toEqual({
      productList: 2,
      products: { p1: 2 },
      databases: { d1: 1 },
      versions: { v1: 1 },
    })
    expect(await f.dao.findRevisions({ ...ask, userId: 'u2', productList: false })).toEqual({
      productList: null,
      products: { p2: 2 },
      databases: { d2: 1 },
      versions: { v2: 1 },
    })
  })

  test('answers nothing for an empty request', async () => {
    const f = await arrange()

    expect(
      await f.dao.findRevisions({
        userId: 'u1',
        productList: false,
        productIds: [],
        databaseIds: [],
        versionIds: [],
      }),
    ).toEqual({ productList: null, products: {}, databases: {}, versions: {} })
  })

  test('leaves out a deleted database or product and everything under it', async () => {
    const f = await arrange()
    await f.databases.delete({
      userId: 'u1',
      allowedRoles: ['owner'],
      productId: 'p1',
      databaseId: 'd1',
      expectedUpdatedAt: 1000,
      now: 2000,
      audit: audit('a-delete', 'p1'),
    })

    expect(await f.dao.findRevisions(ask)).toMatchObject({
      products: { p1: 3 },
      databases: {},
      versions: {},
    })
    await f.markProductDeleted('p1')
    expect((await f.dao.findRevisions(ask)).products).toEqual({})
  })
}
