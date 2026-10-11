import type { MemberDao } from '../dao/member.interface.ts'

/** Membership changes. The DAO's shapes are already the domain's, so this passes them through. */
export type MemberRepository = MemberDao

export const createMemberRepository = (dao: MemberDao): MemberRepository => ({
  changeRole: (input) => dao.changeRole(input),
  transferOwnership: (input) => dao.transferOwnership(input),
  remove: (input) => dao.remove(input),
})
