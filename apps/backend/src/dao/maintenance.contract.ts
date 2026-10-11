import { expect, test } from 'vite-plus/test'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { MaintenanceDao } from './maintenance.interface.ts'

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

  test('deletes audit log entries made at or before the cutoff', async () => {
    const f = await setup()
    await f.addAuditLog(entry('a1', { action: 'create', createdAt: 999 }))
    await f.addAuditLog(entry('a2', { action: 'create', createdAt: 1000 }))
    await f.addAuditLog(entry('a3', { action: 'create', createdAt: 1001 }))

    expect(await f.dao.deleteAuditLogs(1000, 10)).toBe(2)
    expect(Object.keys(await f.auditLogs())).toEqual(['a3'])
  })
}
