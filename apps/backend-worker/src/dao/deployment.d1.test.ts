import { deploymentDaoContract } from 'backend/src/dao/deployment.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createDeploymentD1Dao } from './deployment.d1.ts'
import { createTestD1 } from './test-d1.ts'
let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())
deploymentDaoContract(async () => {
  const f = await createTestD1()
  dispose = f.dispose
  const { db } = f
  await db.batch([
    db.prepare(
      "INSERT INTO users(id,name,terms_version,agreed_at,last_login_at,created_at) VALUES('u1','user','v',0,0,0)",
    ),
    db.prepare(
      "INSERT INTO products(id,name,target,created_at,updated_at) VALUES('p1','product','postgresql18',1000,1000)",
    ),
    db.prepare("INSERT INTO product_members VALUES('p1','u1','owner',1000)"),
    db.prepare(
      "INSERT INTO databases(id,product_id,name,created_at,updated_at) VALUES('d1','p1','main',1000,1000)",
    ),
    db.prepare(
      "INSERT INTO versions(id,database_id,number,status,revision,created_at,updated_at) VALUES('v1','d1',1,'provisional',1,1000,1000)",
    ),
    db.prepare(
      "INSERT INTO connections(id,product_id,name,connection_string,sort_order,created_at,updated_at) VALUES('c1','p1','test','postgres://user@db.example.com/main',1,1000,1000)",
    ),
  ])
  return {
    dao: createDeploymentD1Dao(db),
    audits: async () =>
      (await db.prepare('SELECT count(*) n FROM audit_logs').first<{ n: number }>())!.n,
    revision: async () =>
      (await db
        .prepare("SELECT revision FROM databases WHERE id='d1'")
        .first<{ revision: number }>())!.revision,
    changeVersion: async () => {
      await db.prepare("UPDATE versions SET revision=2 WHERE id='v1'").run()
    },
  }
})
