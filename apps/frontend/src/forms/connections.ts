import type { Connection } from '../composables/useProductQuery.ts'

export interface ConnectionDraft {
  key: string
  saved: Connection | null
  name: string
  connectionString: string
  password: string
  removePassword: boolean
}
export const connectionDraft = (saved: Connection | null = null): ConnectionDraft => ({
  key: saved?.id ?? crypto.randomUUID(),
  saved,
  name: saved?.name ?? '',
  connectionString: saved?.connectionString ?? '',
  password: '',
  removePassword: false,
})
export const connectionInput = (row: ConnectionDraft) => ({
  name: row.name.trim(),
  connectionString: row.connectionString.trim(),
  ...(row.removePassword ? { password: null } : row.password ? { password: row.password } : {}),
})
export const connectionChanged = (row: ConnectionDraft) =>
  !row.saved ||
  row.name.trim() !== row.saved.name ||
  row.connectionString.trim() !== row.saved.connectionString ||
  !!row.password ||
  row.removePassword
