import type { AuditLogRecord } from './audit-log.interface.ts'
import type { Role } from './product.interface.ts'

/**
 * Who changes the members and what to log. Every write is refused (`stale_update`) if the actor no
 * longer has one of `allowedRoles` or the product was deleted, bumps the product revision and the
 * product list revision of every user whose list changes, and returns the actor's.
 */
interface MemberWrite {
  productId: string
  userId: string
  allowedRoles: Role[]
  audit: AuditLogRecord
}

type Revisions = { productRevision: number; productsRevision: number }

export interface MemberDao {
  /** Changes a member's role from `from` to `to`; `stale_update` if it's no longer `from`. */
  changeRole: (
    input: MemberWrite & { targetUserId: string; from: Role; to: Role },
  ) => Promise<Revisions>
  /**
   * Makes `targetUserId` (a manager or member) the owner and the current owner (`userId`) a
   * manager. Throws `duplicate` if the new owner already owns another product of this name.
   */
  transferOwnership: (input: MemberWrite & { targetUserId: string }) => Promise<Revisions>
  /**
   * Removes a member whose role is one of `targetRoles` (`stale_update` otherwise). The actor may be
   * the member themself (leaving).
   */
  remove: (input: MemberWrite & { targetUserId: string; targetRoles: Role[] }) => Promise<Revisions>
}
