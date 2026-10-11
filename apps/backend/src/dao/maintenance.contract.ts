import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { MaintenanceDao, PurgeKind } from './maintenance.interface.ts'

/** Access to the store underneath a `MaintenanceDao`, for arranging and checking the tests. */
export interface MaintenanceDaoFixture {
  dao: MaintenanceDao
  /** Products p1 and p2 (revision 1) and user u1 exist from the start. */
  addSession: (id: string, expiresAt: number) => Promise<void>
  addInvitation: (id: string, productId: string, expiresAt: number) => Promise<void>
  addPasscodeFailure: (id: string, failedAt: number) => Promise<void>
  addAuditLog: (entry: AuditLogRecord) => Promise<void>
  sessionIds: () => Promise<string[]>
  invitationIds: () => Promise<string[]>
  passcodeFailureIds: () => Promise<string[]>
  /** Summary by audit log entry ID. */
  auditLogs: () => Promise<Record<string, string>>
  productRevision: (productId: string) => Promise<number>
  /** A database with version `v-<id>` holding object `o-<id>`. */
  addDatabase: (id: string, productId: string) => Promise<void>
  /** Another version of a database, created from `sourceVersionId`. */
  addVersion: (id: string, databaseId: string, sourceVersionId: string) => Promise<void>
  addConnection: (id: string, productId: string) => Promise<void>
  /** User u1 as a member of the product. */
  addMember: (productId: string) => Promise<void>
  /** A deployment of the database's version `v-<databaseId>` through the connection. */
  addDeployment: (input: {
    id: string
    productId: string
    databaseId: string
    connectionId: string
    status: 'running' | 'succeeded'
  }) => Promise<void>
  markDeleted: (kind: PurgeKind, id: string, deletedAt: number) => Promise<void>
  /** Rows left in a table. */
  count: (
    table:
      | 'products'
      | 'product_members'
      | 'invitations'
      | 'connections'
      | 'databases'
      | 'versions'
      | 'objects'
      | 'deployments'
      | 'audit_logs',
  ) => Promise<number>
  sourceVersionOf: (versionId: string) => Promise<string | null>
}

/** Behavior every `MaintenanceDao` must share. */
export const maintenanceDaoContract = (setup: () => Promise<MaintenanceDaoFixture>) => {
  const sorted = async (ids: Promise<string[]>) => (await ids).toSorted()
  const entry = (id: string, overrides: Partial<AuditLogRecord> = {}): AuditLogRecord => ({
    id,
    productId: 'p1',
    userId: 'u1',
    targetType: 'member',
    action: 'invite',
    summary: `${id}@example.com（マネージャー）`,
    createdAt: 1000,
    ...overrides,
  })

  test('deletes sessions expired at the cutoff, a limited number at a time', async () => {
    const f = await setup()
    await f.addSession('s1', 999)
    await f.addSession('s2', 1000)
    await f.addSession('s3', 1001)

    expect(await f.dao.deleteExpiredSessions(1000, 1)).toBe(1)
    expect(await f.dao.deleteExpiredSessions(1000, 1)).toBe(1)
    expect(await f.dao.deleteExpiredSessions(1000, 1)).toBe(0)
    expect(await f.sessionIds()).toEqual(['s3'])
  })

  test('deletes expired invitations, bumping their products’ revisions once', async () => {
    const f = await setup()
    await f.addInvitation('i1', 'p1', 1000)
    await f.addInvitation('i2', 'p1', 900)
    await f.addInvitation('i3', 'p1', 1001)
    await f.addInvitation('i4', 'p2', 2000)

    expect(await f.dao.deleteExpiredInvitations(1000, 10)).toBe(2)

    expect(await sorted(f.invitationIds())).toEqual(['i3', 'i4'])
    expect(await f.productRevision('p1')).toBe(2)
    expect(await f.productRevision('p2')).toBe(1)
    expect(await f.dao.deleteExpiredInvitations(1000, 10)).toBe(0)
    expect(await f.productRevision('p1')).toBe(2)
  })

  test('deletes old passcode failures', async () => {
    const f = await setup()
    await f.addPasscodeFailure('f1', 1000)
    await f.addPasscodeFailure('f2', 1001)

    expect(await f.dao.deletePasscodeFailures(1000, 10)).toBe(1)
    expect(await f.passcodeFailureIds()).toEqual(['f2'])
  })

  test('replaces the email of old invitation entries only, once', async () => {
    const f = await setup()
    await f.addAuditLog(entry('old'))
    await f.addAuditLog(entry('new', { createdAt: 1001 }))
    await f.addAuditLog(entry('join', { action: 'join', summary: 'a@example.com' }))
    await f.addAuditLog(entry('bare', { summary: 'b@example.com' }))
    const redact = () =>
      f.dao.redactInvitationEmails({ cutoff: 1000, replacement: '削除済み', limit: 10 })

    expect(await redact()).toBe(2)
    expect(await redact()).toBe(0)

    expect(await f.auditLogs()).toEqual({
      old: '削除済み（マネージャー）',
      new: 'new@example.com（マネージャー）',
      join: 'a@example.com',
      bare: '削除済み',
    })
  })

  // p1 (deleted at 1000) holds d1 with a finished deployment, a connection, a member, an
  // invitation and an audit log entry; p2 (not deleted) holds d2 (deleted at 1000) and d3, whose
  // v3 was created from d2's version.
  const arrangePurge = async () => {
    const f = await setup()
    await f.addDatabase('d1', 'p1')
    await f.addConnection('c1', 'p1')
    await f.addMember('p1')
    await f.addInvitation('i1', 'p1', 5000)
    await f.addAuditLog(entry('a1', { action: 'create' }))
    await f.addDeployment({
      id: 'x1',
      productId: 'p1',
      databaseId: 'd1',
      connectionId: 'c1',
      status: 'succeeded',
    })
    await f.addDatabase('d2', 'p2')
    await f.addDatabase('d3', 'p2')
    await f.addVersion('v3', 'd3', 'v-d2')
    await f.addConnection('c2', 'p2')
    await f.addDeployment({
      id: 'x2',
      productId: 'p2',
      databaseId: 'd2',
      connectionId: 'c2',
      status: 'succeeded',
    })
    await f.markDeleted('product', 'p1', 1000)
    await f.markDeleted('database', 'd2', 1000)
    return f
  }

  test('finds deleted products and databases past the cutoff, with their deployments', async () => {
    const f = await arrangePurge()
    const find = (kind: PurgeKind, cutoff = 1000, after: string | null = null) =>
      f.dao.findPurgeable({ kind, cutoff, after, limit: 10 })

    expect(await find('product')).toEqual([{ id: 'p1', deploymentIds: ['x1'], running: false }])
    expect(await find('database')).toEqual([{ id: 'd2', deploymentIds: ['x2'], running: false }])
    expect(await find('product', 999)).toEqual([])
    expect(await find('product', 1000, 'p1')).toEqual([])
  })

  test('purges a product with everything under it', async () => {
    const f = await arrangePurge()

    expect(await f.dao.purge({ kind: 'product', id: 'p1', cutoff: 1000 })).toBe(true)

    expect(await f.count('products')).toBe(1)
    expect(await f.count('databases')).toBe(2)
    expect(await f.count('versions')).toBe(3)
    expect(await f.count('objects')).toBe(2)
    expect(await f.count('deployments')).toBe(1)
    expect(await f.count('connections')).toBe(1)
    expect(await f.count('product_members')).toBe(0)
    expect(await f.count('invitations')).toBe(0)
    expect(await f.count('audit_logs')).toBe(0)
    expect(await f.dao.purge({ kind: 'product', id: 'p1', cutoff: 1000 })).toBe(false)
  })

  test('purges a database, leaving its product and versions created from it', async () => {
    const f = await arrangePurge()

    expect(await f.dao.purge({ kind: 'database', id: 'd2', cutoff: 1000 })).toBe(true)

    expect(await f.count('databases')).toBe(2)
    expect(await f.count('versions')).toBe(3)
    expect(await f.count('deployments')).toBe(1)
    expect(await f.count('connections')).toBe(2)
    expect(await f.sourceVersionOf('v3')).toBeNull()
  })

  test('purges nothing too recent, not deleted, or with a deployment still running', async () => {
    const f = await arrangePurge()
    await f.addDeployment({
      id: 'x3',
      productId: 'p2',
      databaseId: 'd2',
      connectionId: 'c2',
      status: 'running',
    })

    expect(
      await f.dao.findPurgeable({ kind: 'database', cutoff: 1000, after: null, limit: 10 }),
    ).toEqual([{ id: 'd2', deploymentIds: ['x2', 'x3'], running: true }])
    expect(await f.dao.purge({ kind: 'product', id: 'p1', cutoff: 999 })).toBe(false)
    expect(await f.dao.purge({ kind: 'product', id: 'p2', cutoff: 1000 })).toBe(false)
    expect(await f.dao.purge({ kind: 'database', id: 'd3', cutoff: 1000 })).toBe(false)
    expect(await f.dao.purge({ kind: 'database', id: 'd2', cutoff: 1000 })).toBe(false)
    expect(await f.count('databases')).toBe(3)
    expect(await f.count('products')).toBe(2)
  })

  test('deletes audit log entries made at or before the cutoff', async () => {
    const f = await setup()
    await f.addAuditLog(entry('a1', { action: 'create', createdAt: 999 }))
    await f.addAuditLog(entry('a2', { action: 'create', createdAt: 1000 }))
    await f.addAuditLog(entry('a3', { action: 'create', createdAt: 1001 }))

    expect(await f.dao.deleteAuditLogs(1000, 10)).toBe(2)
    expect(Object.keys(await f.auditLogs())).toEqual(['a3'])
  })
}
