import type { Role } from '../dao/product.interface.ts'
import { AppError } from '../error.ts'

/**
 * The spec's permission table ("総論 > 権限"): which roles may perform each operation on a
 * product. Every service checks it before a change, and passes the allowed roles to the DAO so the
 * write is refused if the role changed in between.
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

/** Throws `forbidden` unless the role may perform the operation. */
export const assertAllowed = (role: Role, operation: Operation): void => {
  if (!isAllowed(role, operation)) throw new AppError('forbidden')
}
