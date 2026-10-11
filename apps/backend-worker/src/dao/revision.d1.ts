import type { RevisionDao } from 'backend/src/dao/revision.interface.ts'

import { productsRevisionOf } from './product.d1.ts'

// Each query takes the user's ID and the IDs as one JSON array (`json_each`), so any number of IDs
// stays within D1's limit on bound parameters. Membership is the product_members primary key.
const PRODUCTS = `SELECT p.id, p.revision FROM products p
  JOIN product_members m ON m.product_id = p.id AND m.user_id = ?
  WHERE p.id IN (SELECT value FROM json_each(?)) AND p.deleted_at IS NULL`

const DATABASES = `SELECT d.id, d.revision FROM databases d
  JOIN products p ON p.id = d.product_id
  JOIN product_members m ON m.product_id = p.id AND m.user_id = ?
  WHERE d.id IN (SELECT value FROM json_each(?)) AND d.deleted_at IS NULL AND p.deleted_at IS NULL`

const VERSIONS = `SELECT v.id, v.revision FROM versions v
  JOIN databases d ON d.id = v.database_id
  JOIN products p ON p.id = d.product_id
  JOIN product_members m ON m.product_id = p.id AND m.user_id = ?
  WHERE v.id IN (SELECT value FROM json_each(?)) AND d.deleted_at IS NULL AND p.deleted_at IS NULL`

type RevisionRow = { id: string; revision: number }

/** D1 `RevisionDao`. */
export const createRevisionD1Dao = (db: D1Database): RevisionDao => ({
  findRevisions: async ({ userId, productList, productIds, databaseIds, versionIds }) => {
    const byId = (sql: string, ids: string[]) => db.prepare(sql).bind(userId, JSON.stringify(ids))
    // One batch is one transaction, so the revisions are of the same moment.
    const [list, products, databases, versions] = await db.batch([
      productsRevisionOf(db, userId),
      byId(PRODUCTS, productIds),
      byId(DATABASES, databaseIds),
      byId(VERSIONS, versionIds),
    ])
    const toMap = (result: D1Result | undefined) =>
      Object.fromEntries(
        ((result?.results ?? []) as RevisionRow[]).map((row) => [row.id, row.revision]),
      )
    const listRow = list?.results[0] as { products_revision: number } | undefined
    return {
      productList: productList ? (listRow?.products_revision ?? null) : null,
      products: toMap(products),
      databases: toMap(databases),
      versions: toMap(versions),
    }
  },
})
