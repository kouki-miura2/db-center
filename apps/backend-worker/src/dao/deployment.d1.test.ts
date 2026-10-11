import { deploymentDaoContract, deploymentRecord } from 'backend/src/dao/deployment.contract.ts'
import { deploymentView } from 'backend/src/repository/deployment.repository.ts'
import { afterEach, expect, test } from 'vite-plus/test'

import { createConnectionD1Dao } from './connection.d1.ts'
import { createDeploymentD1Dao } from './deployment.d1.ts'
import { createObjectD1Dao } from './object.d1.ts'
import { createTestD1 } from './test-d1.ts'
import { createVersionD1Dao } from './version.d1.ts'
let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())
const setup = async () => {
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
    db,
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
}

deploymentDaoContract(setup)

test('D1 protects running migration sources and preserves history when connection is deleted', async () => {
  const f = await setup(),
    r = {
      ...deploymentRecord(),
      kind: 'migration' as const,
      fromVersionId: 'v1',
      toVersionId: 'v2',
      sourceRevision: 1,
    }
  await f.db
    .prepare(
      "INSERT INTO versions(id,database_id,number,status,revision,created_at,updated_at) VALUES('v2','d1',2,'final',1,1000,1000)",
    )
    .run()
  const actor = {
    userId: 'u1',
    allowedRoles: ['owner' as const],
    audit: {
      id: crypto.randomUUID(),
      productId: 'p1',
      userId: 'u1',
      targetType: 'deployment' as const,
      action: 'started',
      summary: 'test',
      createdAt: 1000,
    },
  }
  await f.dao.accept({ record: r, connectionUpdatedAt: 1000, ...actor })
  const context = (await createObjectD1Dao(f.db).findContext('v1'))!,
    original = await f.revision(),
    auditCount = await f.audits()
  await expect(
    createVersionD1Dao(f.db).transition({
      context,
      ...actor,
      expectedUpdatedAt: 1000,
      expectedRevision: 1,
      to: 'editing',
      memo: null,
      acknowledgeApplied: true,
      now: 2000,
    }),
  ).rejects.toMatchObject({ code: 'stale_update' })
  const remove = {
    ...actor,
    audit: { ...actor.audit, id: crypto.randomUUID() },
    productId: 'p1',
    connectionId: 'c1',
    expectedUpdatedAt: 1000,
  }
  await expect(createConnectionD1Dao(f.db).delete(remove)).rejects.toMatchObject({
    code: 'stale_update',
  })
  expect(await f.revision()).toBe(original)
  expect(await f.audits()).toBe(auditCount)
  await f.dao.finish(r.id, 'succeeded', '{}', 2000)
  const before = await f.revision()
  await createConnectionD1Dao(f.db).delete(remove)
  expect(await f.revision()).toBe(before + 1)
  const history = (await f.dao.findById(r.id))!
  // The deployment changed with the connection, at the new database revision.
  expect(history.revision).toBe(before + 1)
  expect(deploymentView(history)).toMatchObject({
    connectionId: null,
    connectionName: 'test（削除済み）',
    connectionDeleted: true,
    status: 'succeeded',
  })
})
