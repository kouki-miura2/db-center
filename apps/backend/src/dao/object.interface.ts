import type { Target } from 'utils'

import type { AuditLogRecord } from './audit-log.interface.ts'
import type { VersionRecord } from './database.interface.ts'
import type { Role } from './product.interface.ts'

export interface ObjectRecord {
  id: string
  versionId: string
  objectKey: string
  kind: 'schema' | 'table' | 'view' | 'materialized_view' | 'sequence'
  schemaKey: string | null
  name: string
  logicalName: string | null
  definition: string
  updatedBy: string
  updatedAt: number
  revision: number
  deletedAt: number | null
}
export interface VersionContext {
  version: VersionRecord
  productId: string
  databaseName: string
  target: Target
}
export interface ObjectWrite {
  context: VersionContext
  userId: string
  allowedRoles: Role[]
  audit: AuditLogRecord
  now: number
  record: ObjectRecord
  expectedUpdatedAt: number | null
  delete: boolean
  maxObjects: number
  maxBytes: number
  expectedRevision?: number
}
export interface ObjectDao {
  findContext: (versionId: string) => Promise<VersionContext | null>
  findScope: (
    versionId: string,
    since?: number,
  ) => Promise<{ context: VersionContext; objects: ObjectRecord[] } | null>
  save: (input: ObjectWrite) => Promise<{
    object: ObjectRecord
    revisions: { version: number; database: number; product: number }
  }>
}
