import { expect, test } from 'vite-plus/test'

import { isIdentifierWithinLimit, isTarget } from './target.ts'

test('accepts only the listed targets', () => {
  expect(isTarget('postgresql18')).toBe(true)
  expect(isTarget('sqlite3')).toBe(true)
  expect(isTarget('mysql8')).toBe(false)
  expect(isTarget('toString')).toBe(false)
  expect(isTarget(undefined)).toBe(false)
})

test('limits a PostgreSQL 18 physical name to 63 UTF-8 bytes', () => {
  expect(isIdentifierWithinLimit('postgresql18', 'a'.repeat(63))).toBe(true)
  expect(isIdentifierWithinLimit('postgresql18', 'a'.repeat(64))).toBe(false)
  // 21 characters, 63 bytes / 22 characters, 66 bytes
  expect(isIdentifierWithinLimit('postgresql18', '顧'.repeat(21))).toBe(true)
  expect(isIdentifierWithinLimit('postgresql18', '顧'.repeat(22))).toBe(false)
})

test('does not limit a SQLite 3 physical name', () => {
  expect(isIdentifierWithinLimit('sqlite3', 'a'.repeat(1000))).toBe(true)
})
