import { databaseDaoContract } from 'backend/src/dao/database.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createDatabaseD1Dao } from './database.d1.ts'
import { createProductD1Dao } from './product.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

databaseDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  for (const id of ['u1', 'u2']) {
    await db
      .prepare(
        "INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at) VALUES (?, ?, ?, ?, 'v', 0, 0, 1, 0)",
      )
      .bind(id, `sub-${id}`, `${id}@example.com`, id)
      .run()
  }
  return {
    dao: createDatabaseD1Dao(db),
    products: createProductD1Dao(db),
    addMember: async (productId, userId, role) => {
      await db
        .prepare(
          'INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, ?, ?, 0)',
        )
        .bind(productId, userId, role)
        .run()
    },
    markProductDeleted: async (productId) => {
      await db.prepare('UPDATE products SET deleted_at = 5000 WHERE id = ?').bind(productId).run()
    },
    countAuditLogs: async () =>
      (await db.prepare('SELECT count(*) AS n FROM audit_logs').first<{ n: number }>())?.n ?? 0,
    objectNames: async (versionId) =>
      (
        await db
          .prepare('SELECT name FROM objects WHERE version_id = ?')
          .bind(versionId)
          .all<{ name: string }>()
      ).results.map((row) => row.name),
    definitionBytes: async (versionId) =>
      (
        await db
          .prepare('SELECT definition_bytes FROM versions WHERE id = ?')
          .bind(versionId)
          .first<{ definition_bytes: number }>()
      )?.definition_bytes ?? 0,
  }
})
