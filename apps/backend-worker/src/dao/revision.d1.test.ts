import { revisionDaoContract } from 'backend/src/dao/revision.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createDatabaseD1Dao } from './database.d1.ts'
import { createProductD1Dao } from './product.d1.ts'
import { createRevisionD1Dao } from './revision.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

revisionDaoContract(async () => {
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
    dao: createRevisionD1Dao(db),
    products: createProductD1Dao(db),
    databases: createDatabaseD1Dao(db),
    markProductDeleted: async (productId) => {
      await db.prepare('UPDATE products SET deleted_at = 5000 WHERE id = ?').bind(productId).run()
    },
  }
})
