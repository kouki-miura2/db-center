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
    addDatabase: async (id, productId) => {
      await db.batch([
        db
          .prepare(
            'INSERT INTO databases (id, product_id, name, created_at, updated_at) VALUES (?, ?, ?, 0, 0)',
          )
          .bind(id, productId, id),
        db
          .prepare(
            "INSERT INTO versions (id, database_id, number, status, created_at, updated_at) VALUES (?, ?, 1, 'final', 0, 0)",
          )
          .bind(`v-${id}`, id),
        db
          .prepare(
            "INSERT INTO objects (id, version_id, object_key, kind, name, definition, updated_by, updated_at, revision) VALUES (?, ?, 'k', 'schema', 'public', '{}', 'u1', 0, 1)",
          )
          .bind(`o-${id}`, `v-${id}`),
      ])
    },
    addVersion: async (id, databaseId, sourceVersionId) => {
      await db
        .prepare(
          "INSERT INTO versions (id, database_id, number, status, source_version_id, created_at, updated_at) VALUES (?, ?, 2, 'editing', ?, 0, 0)",
        )
        .bind(id, databaseId, sourceVersionId)
        .run()
    },
    addConnection: async (id, productId) => {
      await db
        .prepare(
          "INSERT INTO connections (id, product_id, name, connection_string, sort_order, created_at, updated_at) VALUES (?, ?, ?, 'postgresql://db.example.com/app', 1, 0, 0)",
        )
        .bind(id, productId, id)
        .run()
    },
    addMember: async (productId) => {
      await db
        .prepare(
          "INSERT INTO product_members (product_id, user_id, role, joined_at) VALUES (?, 'u1', 'owner', 0)",
        )
        .bind(productId)
        .run()
    },
    addDeployment: async ({ id, productId, databaseId, connectionId, status }) => {
      await db
        .prepare(
          "INSERT INTO deployments (id, product_id, database_id, connection_id, connection_name, kind, to_version_id, status, executed_by, started_at) VALUES (?, ?, ?, ?, 'conn', 'build', ?, ?, 'u1', 0)",
        )
        .bind(id, productId, databaseId, connectionId, `v-${databaseId}`, status)
        .run()
    },
    markDeleted: async (kind, id, deletedAt) => {
      await db
        .prepare(
          `UPDATE ${kind === 'product' ? 'products' : 'databases'} SET deleted_at = ? WHERE id = ?`,
        )
        .bind(deletedAt, id)
        .run()
    },
    count: async (table) =>
      (await db.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0,
    sourceVersionOf: async (versionId) =>
      (
        await db
          .prepare('SELECT source_version_id FROM versions WHERE id = ?')
          .bind(versionId)
          .first<{ source_version_id: string | null }>()
      )?.source_version_id ?? null,
  }
})
