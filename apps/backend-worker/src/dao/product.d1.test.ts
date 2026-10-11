import { productDaoContract } from 'backend/src/dao/product.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createProductD1Dao } from './product.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

productDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  const addUser = async (id: string) => {
    await db
      .prepare(
        "INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at) VALUES (?, ?, ?, ?, 'v', 0, 0, 1, 0)",
      )
      .bind(id, `sub-${id}`, `${id}@example.com`, id)
      .run()
  }
  for (const id of ['u1', 'u2', 'u3']) await addUser(id)
  const count = async (sql: string, ...params: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...params)
        .first<{ n: number }>()
    )?.n ?? 0
  return {
    dao: createProductD1Dao(db),
    addUser,
    addMember: async (productId, userId, role) => {
      await db
        .prepare(
          'INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, ?, 1000)',
        )
        .bind(productId, userId, role)
        .run()
    },
    markDeleted: async (productId) => {
      await db.prepare('UPDATE products SET deleted_at = 5000 WHERE id = ?').bind(productId).run()
    },
    countAuditLogs: () => count('SELECT count(*) AS n FROM audit_logs'),
    productsRevision: (userId) =>
      count('SELECT products_revision AS n FROM users WHERE id = ?', userId),
  }
})
