import { expect, test } from 'vite-plus/test'

import { assertAllowed } from './permission.ts'

// The table itself is tested in `packages/utils` (`permission/permission.test.ts`).
test('assertAllowed throws forbidden for a role that may not', () => {
  expect(() => assertAllowed('member', 'renameProduct')).toThrow(
    expect.objectContaining({ code: 'forbidden' }),
  )
  expect(() => assertAllowed('manager', 'renameProduct')).not.toThrow()
})
