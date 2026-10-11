import type { MemberDao } from 'backend/src/dao/member.interface.ts'
import type { Role } from 'backend/src/dao/product.interface.ts'

import { guard, insertAuditLog, runBatch, staleGuard } from './batch.ts'
import { actorHasRole, bumpProductRevision, productsRevisionOf } from './product.d1.ts'

const bumpUser = (db: D1Database, userId: string) =>
  db.prepare('UPDATE users SET products_revision = products_revision + 1 WHERE id = ?').bind(userId)

const placeholders = (values: unknown[]) => values.map(() => '?').join(', ')

// The product revision (from bumpProductRevision) and the actor's list revision (productsRevisionOf)
// at the given statement indexes.
const revisions = (results: D1Result[], productAt: number, actorAt: number) => ({
  productRevision:
    (results[productAt]?.results[0] as { revision: number } | undefined)?.revision ?? 0,
  productsRevision:
    (results[actorAt]?.results[0] as { products_revision: number } | undefined)
      ?.products_revision ?? 0,
})

/** D1 `MemberDao`. */
export const createMemberD1Dao = (db: D1Database): MemberDao => ({
  changeRole: async ({ productId, userId, allowedRoles, audit, targetUserId, from, to }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      db
        .prepare(
          'UPDATE product_members SET role = ? WHERE product_id = ? AND user_id = ? AND role = ?',
        )
        .bind(to, productId, targetUserId, from),
      staleGuard(db),
      bumpProductRevision(db, productId),
      bumpUser(db, targetUserId),
      productsRevisionOf(db, userId),
      insertAuditLog(db, audit),
    ])
    return revisions(results, 3, 5)
  },

  transferOwnership: async ({ productId, userId, allowedRoles, audit, targetUserId }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      // Demote first: the product may have at most one owner after every statement.
      db
        .prepare(
          "UPDATE product_members SET role = 'manager' WHERE product_id = ? AND user_id = ? AND role = 'owner'",
        )
        .bind(productId, userId),
      staleGuard(db),
      db
        .prepare(
          "UPDATE product_members SET role = 'owner' WHERE product_id = ? AND user_id = ? AND role IN ('manager', 'member')",
        )
        .bind(productId, targetUserId),
      staleGuard(db),
      guard(
        db,
        'duplicate',
        `EXISTS (
          SELECT 1 FROM product_members m JOIN products p ON p.id = m.product_id
          WHERE m.user_id = ? AND m.role = 'owner' AND p.id <> ? AND p.deleted_at IS NULL
            AND p.name = (SELECT name FROM products WHERE id = ?)
        )`,
        targetUserId,
        productId,
        productId,
      ),
      bumpProductRevision(db, productId),
      bumpUser(db, userId),
      bumpUser(db, targetUserId),
      productsRevisionOf(db, userId),
      insertAuditLog(db, audit),
    ])
    return revisions(results, 6, 9)
  },

  remove: async ({ productId, userId, allowedRoles, audit, targetUserId, targetRoles }) => {
    const results = await runBatch(db, [
      actorHasRole(db, productId, userId, allowedRoles),
      db
        .prepare(
          `DELETE FROM product_members WHERE product_id = ? AND user_id = ? AND role IN (${placeholders(targetRoles)})`,
        )
        .bind(productId, targetUserId, ...(targetRoles as Role[])),
      staleGuard(db),
      bumpProductRevision(db, productId),
      bumpUser(db, targetUserId),
      productsRevisionOf(db, userId),
      insertAuditLog(db, audit),
    ])
    return revisions(results, 3, 5)
  },
})
