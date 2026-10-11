import { expect, test } from 'vite-plus/test'

import type { InvitationRecord } from '../dao/invitation.interface.ts'
import { toPendingInvitation } from './invitation.repository.ts'

test('a pending invitation carries no passcode, hashed or encrypted', () => {
  const record: InvitationRecord = {
    id: 'i1',
    productId: 'p1',
    email: 'a@example.com',
    role: 'manager',
    passcodeHash: 'hash',
    passcodeEncrypted: 'v1.cipher',
    invitedBy: 'u1',
    expiresAt: 2,
    createdAt: 1,
  }

  expect(toPendingInvitation(record)).toEqual({
    id: 'i1',
    email: 'a@example.com',
    role: 'manager',
    expiresAt: 2,
    createdAt: 1,
  })
})
