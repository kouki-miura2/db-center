import { afterEach, beforeEach, expect, test } from 'vite-plus/test'

import {
  bumpMembersProductsRevision,
  insertAuditLog,
  limitGuard,
  runBatch,
  staleGuard,
} from './batch.ts'
import { createTestD1 } from './test-d1.ts'

let db: D1Database
let dispose: () => Promise<void>

beforeEach(async () => {
  ;({ db, dispose } = await createTestD1())
  await db.batch([
    db.prepare("INSERT INTO users VALUES ('u1', 's1', 'a@x', 'A', 'v', 0, 0, 1, 0, NULL)"),
    db.prepare("INSERT INTO users VALUES ('u2', 's2', 'b@x', 'B', 'v', 0, 0, 1, 0, NULL)"),
    db.prepare("INSERT INTO products VALUES ('p1', 'P', 'postgresql18', 0, 100, 1, NULL)"),
    db.prepare("INSERT INTO product_members VALUES ('p1', 'u1', 'owner', 0)"),
  ])
})

afterEach(() => dispose())

// The shape of every D1 write: conditional update, guard, audit log, revisions — one batch.
const rename = (name: string, expectedUpdatedAt: number, now: number) =>
  runBatch(db, [
    db
      .prepare(
        "UPDATE products SET name = ?, updated_at = max(?, updated_at + 1), revision = revision + 1 WHERE id = 'p1' AND updated_at = ? AND deleted_at IS NULL RETURNING updated_at, revision",
      )
      .bind(name, now, expectedUpdatedAt),
    staleGuard(db),
    insertAuditLog(db, {
      id: crypto.randomUUID(),
      productId: 'p1',
      userId: 'u1',
      targetType: 'product',
      action: 'update',
      summary: name,
      createdAt: now,
    }),
    bumpMembersProductsRevision(db, 'p1'),
  ])

const snapshot = async () => ({
  product: await db
    .prepare("SELECT name, updated_at, revision FROM products WHERE id = 'p1'")
    .first(),
  auditLogs: (await db.prepare('SELECT count(*) AS n FROM audit_logs').first<{ n: number }>())?.n,
  productsRevisions: (
    await db.prepare('SELECT products_revision AS r FROM users ORDER BY id').all<{ r: number }>()
  ).results.map(({ r }) => r),
})

test('writes the data, the audit log and the revisions together', async () => {
  const [updated] = await rename('Q', 100, 200)

  expect(updated?.results).toEqual([{ updated_at: 200, revision: 2 }])
  expect(await snapshot()).toEqual({
    product: { name: 'Q', updated_at: 200, revision: 2 },
    auditLogs: 1,
    productsRevisions: [2, 1], // only the member's
  })
})

test('changes nothing on a stale updated_at', async () => {
  const before = await snapshot()

  await expect(rename('Q', 99, 200)).rejects.toMatchObject({ code: 'stale_update' })
  expect(await snapshot()).toEqual(before)
})

test('lets exactly one of two concurrent saves from the same snapshot win', async () => {
  const results = await Promise.allSettled([rename('S1', 100, 200), rename('S2', 100, 200)])

  expect(results.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected'])
  expect(await snapshot()).toMatchObject({ auditLogs: 1, productsRevisions: [2, 1] })
})

test('issues a newer updated_at for a save in the same millisecond', async () => {
  await rename('Q', 100, 100)

  expect((await snapshot()).product).toMatchObject({ updated_at: 101 })
})

test('rolls back the batch when a limit guard fails', async () => {
  const before = await snapshot()
  const join = () =>
    runBatch(db, [
      db.prepare("INSERT INTO product_members VALUES ('p1', 'u2', 'member', 0)"),
      limitGuard(db, '(SELECT count(*) FROM product_members WHERE product_id = ?) > ?', 'p1', 1),
      bumpMembersProductsRevision(db, 'p1'),
    ])

  await expect(join()).rejects.toMatchObject({ code: 'limit_exceeded' })
  expect(await snapshot()).toEqual(before)
  expect(
    (await db.prepare('SELECT count(*) AS n FROM batch_guard').first<{ n: number }>())?.n,
  ).toBe(0)
})

test('turns a UNIQUE violation into duplicate', async () => {
  await expect(
    runBatch(db, [db.prepare("INSERT INTO product_members VALUES ('p1', 'u2', 'owner', 0)")]),
  ).rejects.toMatchObject({ code: 'duplicate' })
})

test('rethrows any other error as is', async () => {
  await expect(runBatch(db, [db.prepare('SELECT * FROM missing_table')])).rejects.toThrow(
    /no such table/,
  )
})
