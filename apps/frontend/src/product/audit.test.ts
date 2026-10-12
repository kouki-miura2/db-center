import { expect, test } from 'vite-plus/test'

import { auditText } from './audit.ts'
const entry = {
  id: 'a1',
  cursor: '1_a1',
  createdAt: 1,
  userId: 'u1',
  userName: '山田 太郎',
  targetType: 'member' as const,
  action: 'invite',
  summary: 'hana@example.com（メンバー）',
}
test('formats the backend invitation summary and departure/transfer as Japanese operations', () => {
  expect(auditText(entry)).toBe('山田 太郎 が hana@example.com をメンバーとして招待')
  expect(auditText({ ...entry, action: 'leave', summary: '山田 太郎' })).toBe(
    '山田 太郎 が プロダクトから退出',
  )
  expect(auditText({ ...entry, action: 'transfer', summary: '鈴木 一郎' })).toBe(
    '山田 太郎 が 鈴木 一郎 にオーナーを譲渡',
  )
})
