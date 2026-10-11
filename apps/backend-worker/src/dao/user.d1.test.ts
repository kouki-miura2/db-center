import { userDaoContract } from 'backend/src/dao/user.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createTestD1 } from './test-d1.ts'
import { createUserD1Dao } from './user.d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

userDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  return {
    dao: createUserD1Dao(db),
    countSessions: async () =>
      (await db.prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>())?.n ?? 0,
    addProduct: async (productId, ownerId, deleted = false) => {
      await db.batch([
        db
          .prepare(
            "INSERT INTO products (id, name, target, created_at, updated_at, revision, deleted_at) VALUES (?, ?, 'postgresql18', 0, 0, 1, ?)",
          )
          .bind(productId, productId, deleted ? 1 : null),
        db
          .prepare(
            "INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, 'owner', 0)",
          )
          .bind(productId, ownerId),
      ])
    },
    addMember: async (productId, userId, role) => {
      await db
        .prepare(
          'INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, ?, 0)',
        )
        .bind(productId, userId, role)
        .run()
    },
    countMemberships: async (userId) =>
      (
        await db
          .prepare('SELECT count(*) AS n FROM product_members WHERE user_id = ?')
          .bind(userId)
          .first<{ n: number }>()
      )?.n ?? 0,
    productRevision: async (productId) =>
      (
        await db
          .prepare('SELECT revision AS n FROM products WHERE id = ?')
          .bind(productId)
          .first<{ n: number }>()
      )?.n ?? 0,
    auditLogs: async () =>
      (
        await db
          .prepare('SELECT product_id, action, summary FROM audit_logs')
          .all<{ product_id: string; action: string; summary: string }>()
      ).results.map((row): [string, string, string] => [row.product_id, row.action, row.summary]),
  }
})
