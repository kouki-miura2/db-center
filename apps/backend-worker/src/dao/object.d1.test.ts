import { objectDaoContract } from 'backend/src/dao/object.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createObjectD1Dao } from './object.d1.ts'
import { createTestD1 } from './test-d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())
objectDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  await db.batch([
    db.prepare(
      "INSERT INTO users (id,name,terms_version,agreed_at,last_login_at,created_at) VALUES ('u1','u','v',0,0,0)",
    ),
    db.prepare(
      "INSERT INTO products (id,name,target,created_at,updated_at) VALUES ('p1','p','postgresql18',1000,1000)",
    ),
    db.prepare("INSERT INTO product_members VALUES ('p1','u1','owner',1000)"),
    db.prepare(
      "INSERT INTO databases (id,product_id,name,created_at,updated_at) VALUES ('d1','p1','db',1000,1000)",
    ),
    db.prepare(
      "INSERT INTO versions (id,database_id,number,status,created_at,updated_at,schema_count,definition_bytes) VALUES ('v1','d1',1,'editing',1000,1000,1,2)",
    ),
    db.prepare(
      "INSERT INTO objects (id,version_id,object_key,kind,name,definition,updated_by,updated_at,revision) VALUES ('s1','v1','schema','schema','public','{}','u1',1000,1)",
    ),
  ])
  return {
    dao: createObjectD1Dao(db),
    audits: async () =>
      (await db.prepare('SELECT count(*) n FROM audit_logs').first<{ n: number }>())!.n,
    removeActor: async () => {
      await db.prepare('DELETE FROM product_members').run()
    },
  }
})
