import type { AuditLogDao } from '../dao/audit-log.dao.interface.ts'

/** Reading a product's audit log. The DAO's shapes are already the domain's. */
export type AuditLogRepository = AuditLogDao

export const createAuditLogRepository = (dao: AuditLogDao): AuditLogRepository => ({
  list: (input) => dao.list(input),
})
