import { expect, test } from 'vite-plus/test'

import { connectionChanged, connectionDraft, connectionInput } from './connections.ts'

test('keeps an existing password by omitting it, and only sends replacement or explicit removal', () => {
  const row = connectionDraft({
    id: 'c1',
    name: '本番',
    connectionString: 'postgresql://user@host/db',
    hasPassword: true,
    sortOrder: 1,
    updatedAt: 10,
  })
  expect(connectionChanged(row)).toBe(false)
  expect(connectionInput(row)).not.toHaveProperty('password')
  row.password = 'replacement'
  expect(connectionChanged(row)).toBe(true)
  expect(connectionInput(row)).toMatchObject({ password: 'replacement' })
  row.removePassword = true
  expect(connectionInput(row)).toMatchObject({ password: null })
  expect(row.saved).not.toHaveProperty('password')
})
