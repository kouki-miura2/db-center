import { auditLogDaoContract } from 'backend/src/dao/audit-log.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createAuditLogD1Dao } from './audit-log.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

auditLogDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at) VALUES ('u1', 'sub-1', 'u1@example.com', 'はなこ', 'v', 0, 0, 1, 0)",
    ),
    db.prepare(
      "INSERT INTO products (id, name, target, created_at, updated_at, revision) VALUES ('p1', 'p1', 'sqlite3', 0, 0, 1), ('p2', 'p2', 'sqlite3', 0, 0, 1)",
    ),
  ])
  return {
    dao: createAuditLogD1Dao(db),
    addEntry: async (id, productId, createdAt) => {
      await db
        .prepare(
          "INSERT INTO audit_logs (id, product_id, user_id, target_type, action, summary, created_at) VALUES (?, ?, 'u1', 'product', 'update', ?, ?)",
        )
        .bind(id, productId, id, createdAt)
        .run()
    },
    renameUser: async (name) => {
      await db.prepare("UPDATE users SET name = ? WHERE id = 'u1'").bind(name).run()
    },
  }
})
