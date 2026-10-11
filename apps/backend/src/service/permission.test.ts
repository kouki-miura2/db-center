import { expect, test } from 'vite-plus/test'

import { assertAllowed, isAllowed, PERMISSIONS } from './permission.ts'

// The spec's table, row by row: owner / manager / member.
test.each([
  ['view', [true, true, true]],
  ['renameProduct', [true, true, false]],
  ['editConnections', [true, true, false]],
  ['deleteProduct', [true, false, false]],
  ['inviteOrRemoveManager', [true, false, false]],
  ['inviteOrRemoveMember', [true, true, false]],
  ['promoteToManager', [true, true, false]],
  ['demoteToMember', [true, false, false]],
  ['transferOwnership', [true, false, false]],
  ['leaveProduct', [false, true, true]],
  ['manageDatabases', [true, true, false]],
  ['editDesign', [true, true, true]],
  ['editCommonColumns', [true, true, true]],
  ['provisionalVersion', [true, true, true]],
  ['finalizeVersion', [true, true, false]],
  ['revertVersion', [true, true, false]],
  ['createVersion', [true, true, false]],
  ['exportDefinition', [true, true, true]],
  ['viewAuditLog', [true, true, true]],
  ['exportScripts', [true, true, true]],
  ['deploy', [true, true, false]],
] as const)('%s', (operation, expected) => {
  expect(
    (['owner', 'manager', 'member'] as const).map((role) => isAllowed(role, operation)),
  ).toEqual(expected)
})

test('covers every operation in the table', () => {
  expect(Object.keys(PERMISSIONS)).toHaveLength(21)
})

test('assertAllowed throws forbidden for a role that may not', () => {
  expect(() => assertAllowed('member', 'renameProduct')).toThrow(
    expect.objectContaining({ code: 'forbidden' }),
  )
  expect(() => assertAllowed('manager', 'renameProduct')).not.toThrow()
})
