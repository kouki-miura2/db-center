import { memberDaoContract } from 'backend/src/dao/member.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createMemberD1Dao } from './member.d1.ts'
import { createProductD1Dao } from './product.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

memberDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  for (const id of ['u1', 'u2', 'u3']) {
    await db
      .prepare(
        "INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at) VALUES (?, ?, ?, ?, 'v', 0, 0, 1, 0)",
      )
      .bind(id, `sub-${id}`, `${id}@example.com`, id)
      .run()
  }
  const count = async (sql: string, ...params: unknown[]) =>
    (
      await db
        .prepare(sql)
        .bind(...params)
        .first<{ n: number }>()
    )?.n ?? 0
  return {
    dao: createMemberD1Dao(db),
    products: createProductD1Dao(db),
    addMember: async (productId, userId, role) => {
      await db
        .prepare(
          'INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, ?, 0)',
        )
        .bind(productId, userId, role)
        .run()
    },
    productsRevision: (userId) =>
      count('SELECT products_revision AS n FROM users WHERE id = ?', userId),
    countAuditLogs: () => count('SELECT count(*) AS n FROM audit_logs'),
  }
})
