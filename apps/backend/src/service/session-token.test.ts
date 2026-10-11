import { expect, test } from 'vite-plus/test'

import { createSessionToken, hashSessionToken } from './session-token.ts'

test('creates a URL-safe token of 32 random bytes, different each time', () => {
  const token = createSessionToken()

  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(createSessionToken()).not.toBe(token)
})

test('hashes a token to its SHA-256 in hex', async () => {
  expect(await hashSessionToken('abc')).toBe(
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  )
})
