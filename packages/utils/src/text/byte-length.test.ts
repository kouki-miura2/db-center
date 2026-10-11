import { expect, test } from 'vite-plus/test'

import { utf8ByteLength } from './byte-length.ts'

test('counts ASCII as one byte each', () => {
  expect(utf8ByteLength('users')).toBe(5)
})

test('counts multi-byte characters by their UTF-8 bytes', () => {
  expect(utf8ByteLength('顧客')).toBe(6)
  expect(utf8ByteLength('𠮷')).toBe(4)
})
