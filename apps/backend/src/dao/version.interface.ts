import type { AuditLogRecord } from './audit-log.interface.ts'
import type { VersionRecord } from './database.interface.ts'
import type { VersionContext } from './object.interface.ts'
import type { Role } from './product.interface.ts'
export interface VersionWrite {
  context: VersionContext
  userId: string
  allowedRoles: Role[]
  expectedUpdatedAt: number
  expectedRevision: number
  now: number
  audit: AuditLogRecord
}
export interface ApplicationRecord {
  id: string
  connectionName: string
  status: 'running' | 'succeeded' | 'failed'
}
export interface VersionDao {
  applications: (versionId: string) => Promise<ApplicationRecord[]>
  transition: (
    input: VersionWrite & {
      to: 'editing' | 'provisional'
      memo: string | null
      acknowledgeApplied: boolean
    },
  ) => Promise<{
    version: VersionRecord
    revisions: { version: number; database: number; product: number }
  }>
}
