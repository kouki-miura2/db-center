/** A participant's role in a product (`docs/spec.md` "総論 > 用語 > ロール"). */
export type Role = 'owner' | 'manager' | 'member'

/** The labels the UI shows for each role. */
export const ROLE_LABELS = {
  owner: 'オーナー',
  manager: 'マネージャー',
  member: 'メンバー',
} as const satisfies Record<Role, string>

/**
 * The spec's permission table ("総論 > 権限"): which roles may perform each operation on a
 * product. The API refuses an operation the role may not perform, and the UI hides its button.
 */
export const PERMISSIONS = {
  view: ['owner', 'manager', 'member'],
  renameProduct: ['owner', 'manager'],
  editConnections: ['owner', 'manager'],
  deleteProduct: ['owner'],
  inviteOrRemoveManager: ['owner'],
  inviteOrRemoveMember: ['owner', 'manager'],
  promoteToManager: ['owner', 'manager'],
  demoteToMember: ['owner'],
  transferOwnership: ['owner'],
  leaveProduct: ['manager', 'member'],
  manageDatabases: ['owner', 'manager'],
  editDesign: ['owner', 'manager', 'member'],
  editCommonColumns: ['owner', 'manager', 'member'],
  provisionalVersion: ['owner', 'manager', 'member'],
  finalizeVersion: ['owner', 'manager'],
  revertVersion: ['owner', 'manager'],
  createVersion: ['owner', 'manager'],
  exportDefinition: ['owner', 'manager', 'member'],
  viewAuditLog: ['owner', 'manager', 'member'],
  exportScripts: ['owner', 'manager', 'member'],
  deploy: ['owner', 'manager'],
} as const satisfies Record<string, readonly Role[]>

export type Operation = keyof typeof PERMISSIONS

export const allowedRoles = (operation: Operation): Role[] => [...PERMISSIONS[operation]]

export const isAllowed = (role: Role, operation: Operation): boolean =>
  (PERMISSIONS[operation] as readonly Role[]).includes(role)
