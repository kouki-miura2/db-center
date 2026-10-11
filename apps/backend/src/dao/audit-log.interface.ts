/** One `audit_logs` row ("各論 > 履歴"). Written in the same batch as the change it records. */
export interface AuditLogRecord {
  id: string
  productId: string
  userId: string
  targetType: 'product' | 'member' | 'connection' | 'database' | 'version' | 'object' | 'deployment'
  action: string
  /** Name of the target at the time, so the entry still reads after it's renamed or deleted. */
  summary: string
  createdAt: number
}
