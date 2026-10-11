import { expect, test } from 'vite-plus/test'

import { nextUpdatedAt } from './write.ts'

test('uses the current time when it is past the previous value', () => {
  expect(nextUpdatedAt(2000, 1000)).toBe(2000)
})

test('still grows when saved again in the same millisecond or with a clock behind', () => {
  expect(nextUpdatedAt(1000, 1000)).toBe(1001)
  expect(nextUpdatedAt(900, 1000)).toBe(1001)
})
