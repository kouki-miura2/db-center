import { expect, test, vi } from 'vite-plus/test'

import type { MaintenanceDao } from '../dao/maintenance.interface.ts'
import { createMaintenanceRepository } from './maintenance.repository.ts'

test('passes every cleanup through to the DAO', async () => {
  const dao: MaintenanceDao = {
    deleteExpiredSessions: vi.fn(async () => 1),
    deleteExpiredInvitations: vi.fn(async () => 2),
    deletePasscodeFailures: vi.fn(async () => 3),
    redactInvitationEmails: vi.fn(async () => 4),
    deleteAuditLogs: vi.fn(async () => 5),
    findPurgeable: vi.fn(async () => []),
    purge: vi.fn(async () => true),
  }
  const repository = createMaintenanceRepository(dao)

  expect(await repository.deleteExpiredSessions(10, 100)).toBe(1)
  expect(
    await repository.redactInvitationEmails({ cutoff: 10, replacement: 'x', limit: 100 }),
  ).toBe(4)
  expect(dao.deleteExpiredSessions).toHaveBeenCalledWith(10, 100)
})
