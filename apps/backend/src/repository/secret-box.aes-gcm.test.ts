import { expect, test } from 'vite-plus/test'

import { createAesGcmSecretBox } from './secret-box.aes-gcm.ts'

const key = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
const otherKey = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))

test('round-trips a secret, with a fresh nonce each time', async () => {
  const box = createAesGcmSecretBox(key)

  const first = await box.encrypt('p@ss word', 'connection-password', 'c1')
  const second = await box.encrypt('p@ss word', 'connection-password', 'c1')

  expect(first).toMatch(/^v1\.[0-9a-f]{8}\.[\w-]+\.[\w-]+$/)
  expect(first).not.toBe(second)
  expect(first).not.toContain('p@ss')
  expect(await box.decrypt(first, 'connection-password', 'c1')).toBe('p@ss word')
})

test.each([
  ['another record', 'connection-password', 'c2'],
  ['another purpose', 'invitation-passcode', 'c1'],
] as const)('refuses to decrypt for %s', async (_, purpose, recordId) => {
  const box = createAesGcmSecretBox(key)
  const ciphertext = await box.encrypt('secret', 'connection-password', 'c1')

  await expect(box.decrypt(ciphertext, purpose, recordId)).rejects.toThrow()
})

test('refuses a ciphertext made with another key', async () => {
  const ciphertext = await createAesGcmSecretBox(otherKey).encrypt(
    'secret',
    'connection-password',
    'c1',
  )

  await expect(
    createAesGcmSecretBox(key).decrypt(ciphertext, 'connection-password', 'c1'),
  ).rejects.toThrow()
})

test('refuses a tampered ciphertext', async () => {
  const box = createAesGcmSecretBox(key)
  const ciphertext = await box.encrypt('secret', 'connection-password', 'c1')
  const tampered = ciphertext.slice(0, -2) + (ciphertext.endsWith('A') ? 'BB' : 'AA')

  await expect(box.decrypt(tampered, 'connection-password', 'c1')).rejects.toThrow()
})

test('without a key, refuses to encrypt rather than store plaintext', async () => {
  await expect(
    createAesGcmSecretBox(undefined).encrypt('secret', 'connection-password', 'c1'),
  ).rejects.toMatchObject({ code: 'invalid_state' })
})

test('rejects a key of the wrong length at startup', () => {
  expect(() => createAesGcmSecretBox(btoa('short'))).toThrow()
})
