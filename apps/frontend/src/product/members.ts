import { isAllowed, type Role } from 'utils'

import type { Member } from '../composables/useProductQuery.ts'

export const memberActions = (actor: Role, ownId: string, member: Member) => ({
  promote: member.role === 'member' && isAllowed(actor, 'promoteToManager'),
  demote: member.role === 'manager' && isAllowed(actor, 'demoteToMember'),
  remove:
    ownId !== member.userId &&
    member.role !== 'owner' &&
    isAllowed(actor, member.role === 'manager' ? 'inviteOrRemoveManager' : 'inviteOrRemoveMember'),
  transfer: ownId !== member.userId && isAllowed(actor, 'transferOwnership'),
})
export const sortMembers = (members: Member[]) => {
  const order = { owner: 0, manager: 1, member: 2 }
  return members.toSorted(
    (a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name, 'ja'),
  )
}
