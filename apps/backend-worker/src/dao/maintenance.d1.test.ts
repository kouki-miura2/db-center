import { maintenanceDaoContract } from 'backend/src/dao/maintenance.contract.ts'
import { afterEach } from 'vite-plus/test'

import { insertAuditLog } from './batch.ts'
import { createMaintenanceD1Dao } from './maintenance.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

maintenanceDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  await db.batch([
    db.prepare(
      "INSERT INTO users (id, google_sub, email, name, terms_version, agreed_at, last_login_at, products_revision, created_at) VALUES ('u1', 'sub-u1', 'u1@example.com', 'u1', 'v', 0, 0, 1, 0)",
    ),
    ...['p1', 'p2'].map((id) =>
      db
        .prepare(
          "INSERT INTO products (id, name, target, created_at, updated_at, revision) VALUES (?, ?, 'postgresql18', 0, 0, 1)",
        )
        .bind(id, id),
    ),
  ])
  const ids = async (sql: string) =>
    (await db.prepare(sql).all<{ id: string }>()).results.map((row) => row.id)
  return {
    dao: createMaintenanceD1Dao(db),
    addSession: async (id, expiresAt) => {
      await db
        .prepare(
          "INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, 'u1', ?, 0)",
        )
        .bind(id, expiresAt)
        .run()
    },
    addInvitation: async (id, productId, expiresAt) => {
      await db
        .prepare(
          "INSERT INTO invitations (id, product_id, email, role, passcode_hash, passcode_encrypted, invited_by, expires_at, created_at) VALUES (?, ?, ?, 'member', 'h', 'e', 'u1', ?, 0)",
        )
        .bind(id, productId, `${id}@example.com`, expiresAt)
        .run()
    },
    addPasscodeFailure: async (id, failedAt) => {
      await db
        .prepare("INSERT INTO passcode_failures (id, user_id, failed_at) VALUES (?, 'u1', ?)")
        .bind(id, failedAt)
        .run()
    },
    addAuditLog: async (entry) => {
      await insertAuditLog(db, entry).run()
    },
    sessionIds: () => ids('SELECT id FROM sessions ORDER BY id'),
    invitationIds: () => ids('SELECT id FROM invitations ORDER BY id'),
    passcodeFailureIds: () => ids('SELECT id FROM passcode_failures ORDER BY id'),
    auditLogs: async () =>
      Object.fromEntries(
        (
          await db
            .prepare('SELECT id, summary FROM audit_logs ORDER BY rowid')
            .all<{ id: string; summary: string }>()
        ).results.map((row) => [row.id, row.summary]),
      ),
    productRevision: async (productId) =>
      (
        await db
          .prepare('SELECT revision FROM products WHERE id = ?')
          .bind(productId)
          .first<{ revision: number }>()
      )?.revision ?? 0,
  }
})
