import { expect, test } from 'vite-plus/test'

import { isDatabaseName } from './database-name.ts'

test('accepts lowercase letters, digits and _ after a leading letter', () => {
  expect(isDatabaseName('ec_main')).toBe(true)
  expect(isDatabaseName('a1_b2')).toBe(true)
  expect(isDatabaseName('a')).toBe(true)
})

test.each(['', '1db', '_db', 'EcMain', 'ec-main', 'ec main', 'データ'])('rejects %j', (name) => {
  expect(isDatabaseName(name)).toBe(false)
})

test('allows up to 63 characters', () => {
  expect(isDatabaseName('a'.repeat(63))).toBe(true)
  expect(isDatabaseName('a'.repeat(64))).toBe(false)
})
