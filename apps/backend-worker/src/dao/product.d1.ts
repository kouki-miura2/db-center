import type {
  MembershipRecord,
  ProductDao,
  ProductRecord,
  Role,
} from 'backend/src/dao/product.interface.ts'

import {
  bumpMembersProductsRevision,
  guard,
  insertAuditLog,
  limitGuard,
  runBatch,
  staleGuard,
} from './batch.ts'

interface ProductRow {
  id: string
  name: string
  target: ProductRecord['target']
  created_at: number
  updated_at: number
  revision: number
  deleted_at: number | null
}

type MembershipRow = ProductRow & { role: Role; joined_at: number }

const toProduct = (row: ProductRow): ProductRecord => ({
  id: row.id,
  name: row.name,
  target: row.target,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  revision: row.revision,
  deletedAt: row.deleted_at,
})

const toMembership = (row: MembershipRow): MembershipRecord => ({
  product: toProduct(row),
  role: row.role,
  joinedAt: row.joined_at,
})

const MEMBERSHIP_SELECT =
  'SELECT products.*, product_members.role, product_members.joined_at FROM product_members JOIN products ON products.id = product_members.product_id'

// The owner of a product already owns another product (not deleted) of a name.
// Params: name, exceptProductId, ownerOfProductId.
const OWNER_HAS_NAME = `EXISTS (
  SELECT 1 FROM product_members m JOIN products p ON p.id = m.product_id
  WHERE m.role = 'owner' AND p.deleted_at IS NULL AND p.name = ? AND p.id <> ?
    AND m.user_id = (SELECT user_id FROM product_members WHERE product_id = ? AND role = 'owner')
)`

const productsRevisionOf = (db: D1Database, userId: string) =>
  db.prepare('SELECT products_revision FROM users WHERE id = ?').bind(userId)

/** D1 `ProductDao` (products and product_members). */
export const createProductD1Dao = (db: D1Database): ProductDao => ({
  findMembership: async (productId, userId) => {
    const row = await db
      .prepare(
        `${MEMBERSHIP_SELECT} WHERE product_members.product_id = ? AND product_members.user_id = ? AND products.deleted_at IS NULL`,
      )
      .bind(productId, userId)
      .first<MembershipRow>()
    return row ? toMembership(row) : null
  },

  findProductsRevision: async (userId) =>
    (await productsRevisionOf(db, userId).first<{ products_revision: number }>())
      ?.products_revision ?? null,

  listForUser: async (userId) => {
    // One batch is one transaction, so the revision matches the list.
    const [revision, list] = await db.batch([
      productsRevisionOf(db, userId),
      db
        .prepare(
          `${MEMBERSHIP_SELECT} WHERE product_members.user_id = ? AND products.deleted_at IS NULL`,
        )
        .bind(userId),
    ])
    return {
      revision:
        (revision?.results[0] as { products_revision: number } | undefined)?.products_revision ?? 1,
      memberships: ((list?.results ?? []) as MembershipRow[]).map(toMembership),
    }
  },

  create: async ({ product, ownerId, maxProducts, audit }) => {
    const results = await runBatch(db, [
      db
        .prepare(
          'INSERT INTO products (id, name, target, created_at, updated_at, revision, deleted_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .bind(
          product.id,
          product.name,
          product.target,
          product.createdAt,
          product.updatedAt,
          product.revision,
          product.deletedAt,
        ),
      db
        .prepare(
          "INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, 'owner', ?)",
        )
        .bind(product.id, ownerId, product.createdAt),
      guard(db, 'duplicate', OWNER_HAS_NAME, product.name, product.id, product.id),
      limitGuard(
        db,
        '(SELECT count(*) FROM product_members m JOIN products p ON p.id = m.product_id WHERE m.user_id = ? AND p.deleted_at IS NULL) > ?',
        ownerId,
        maxProducts,
      ),
      db
        .prepare(
          'UPDATE users SET products_revision = products_revision + 1 WHERE id = ? RETURNING products_revision',
        )
        .bind(ownerId),
      staleGuard(db),
      insertAuditLog(db, audit),
    ])
    const revision = results[4]?.results[0] as { products_revision: number }
    return { productsRevision: revision.products_revision }
  },

  rename: async ({ productId, name, expectedUpdatedAt, now, userId, allowedRoles, audit }) => {
    const results = await runBatch(db, [
      // The actor may have lost the role since the service checked it.
      guard(
        db,
        'stale_update',
        `NOT EXISTS (SELECT 1 FROM product_members WHERE product_id = ? AND user_id = ? AND role IN (${allowedRoles.map(() => '?').join(', ')}))`,
        productId,
        userId,
        ...allowedRoles,
      ),
      db
        .prepare(
          'UPDATE products SET name = ?, updated_at = max(?, updated_at + 1), revision = revision + 1 WHERE id = ? AND updated_at = ? AND deleted_at IS NULL RETURNING *',
        )
        .bind(name, now, productId, expectedUpdatedAt),
      staleGuard(db),
      guard(db, 'duplicate', OWNER_HAS_NAME, name, productId, productId),
      bumpMembersProductsRevision(db, productId),
      productsRevisionOf(db, userId),
      insertAuditLog(db, audit),
    ])
    const product = results[1]?.results[0] as ProductRow
    const revision = results[5]?.results[0] as { products_revision: number }
    return { product: toProduct(product), productsRevision: revision.products_revision }
  },
})
