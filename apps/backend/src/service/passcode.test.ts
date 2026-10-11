import { expect, test } from 'vite-plus/test'

import { createPasscode, hashPasscode } from './passcode.ts'

test('creates 8 uppercase letters and digits, different each time', () => {
  const codes = Array.from({ length: 50 }, createPasscode)

  for (const code of codes) expect(code).toMatch(/^[A-Z0-9]{8}$/)
  expect(new Set(codes).size).toBe(50)
})

test('hashes the same however the code is typed', async () => {
  expect(await hashPasscode(' ab12cd34 ')).toBe(await hashPasscode('AB12CD34'))
  expect(await hashPasscode('AB12CD34')).not.toBe(await hashPasscode('AB12CD35'))
  expect(await hashPasscode('AB12CD34')).toMatch(/^[0-9a-f]{64}$/)
})
