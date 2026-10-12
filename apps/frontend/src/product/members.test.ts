import { expect, test } from 'vite-plus/test'

import { memberActions, sortMembers } from './members.ts'
const member = { userId: 'u2', name: '鈴木', role: 'member' as const, joinedAt: 1 }
test('a manager can promote or remove members, but cannot remove/demote managers or transfer ownership', () => {
  expect(memberActions('manager', 'u1', member)).toEqual({
    promote: true,
    demote: false,
    remove: true,
    transfer: false,
  })
  expect(
    Object.values(memberActions('manager', 'u1', { ...member, role: 'manager' })).some(Boolean),
  ).toBe(false)
  expect(memberActions('manager', 'u2', member).remove).toBe(false)
  expect(Object.values(memberActions('member', 'u1', member)).some(Boolean)).toBe(false)
})
test('keeps the owner first after a transfer or role change', () => {
  expect(
    sortMembers([
      member,
      { ...member, userId: 'u3', role: 'manager' },
      { ...member, userId: 'u1', role: 'owner' },
    ]).map((row) => row.role),
  ).toEqual(['owner', 'manager', 'member'])
})
