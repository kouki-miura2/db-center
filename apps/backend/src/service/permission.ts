import { isAllowed, type Operation, type Role } from 'utils'

import { AppError } from '../error.ts'

// The permission table itself is shared with the frontend (`packages/utils`), which hides the
// buttons of operations a role may not perform. Every service checks it before a change, and
// passes the allowed roles to the DAO so the write is refused if the role changed in between.
export { allowedRoles, isAllowed, PERMISSIONS, type Operation } from 'utils'

/** Throws `forbidden` unless the role may perform the operation. */
export const assertAllowed = (role: Role, operation: Operation): void => {
  if (!isAllowed(role, operation)) throw new AppError('forbidden')
}
