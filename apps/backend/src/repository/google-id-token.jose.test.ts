import { createLocalJWKSet, exportJWK, generateKeyPair, type JWTPayload, SignJWT } from 'jose'
import { beforeAll, expect, test } from 'vite-plus/test'

import type { GoogleIdTokenVerifier } from './google-id-token.interface.ts'
import { createGoogleIdTokenVerifier } from './google-id-token.jose.ts'

const CLIENT_ID = 'client-id.apps.example'
let googleKey: CryptoKey
let otherKey: CryptoKey
let verifier: GoogleIdTokenVerifier

beforeAll(async () => {
  const google = await generateKeyPair('RS256')
  googleKey = google.privateKey
  otherKey = (await generateKeyPair('RS256')).privateKey
  const jwk = { ...(await exportJWK(google.publicKey)), kid: 'k1', alg: 'RS256' }
  verifier = createGoogleIdTokenVerifier({
    clientId: CLIENT_ID,
    keys: createLocalJWKSet({ keys: [jwk] }),
  })
})

const token = (
  overrides: JWTPayload = {},
  { key = googleKey, expiresIn = '1h' }: { key?: CryptoKey; expiresIn?: string } = {},
) =>
  new SignJWT({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    email: 'Hanako@Example.com',
    email_verified: true,
    name: '佐藤 花子',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(key)

test('accepts a valid token and identifies the user by sub, with a lowercased email', async () => {
  expect(await verifier.verify(await token())).toEqual({
    sub: '1234567890',
    email: 'hanako@example.com',
    name: '佐藤 花子',
  })
})

test('accepts the issuer without the scheme too', async () => {
  expect(await verifier.verify(await token({ iss: 'accounts.google.com' }))).not.toBeNull()
})

test.each([
  ['a signature by another key', () => token({}, { key: otherKey })],
  ['another audience', () => token({ aud: 'someone-else' })],
  ['another issuer', () => token({ iss: 'https://evil.example' })],
  ['an expired token', () => token({}, { expiresIn: '-1m' })],
  ['an unverified email', () => token({ email_verified: false })],
  ['no email', () => token({ email: undefined })],
])('rejects %s', async (_, make) => {
  expect(await verifier.verify(await make())).toBeNull()
})

test('rejects a malformed token', async () => {
  expect(await verifier.verify('not-a-jwt')).toBeNull()
})

test('rejects every token when no client ID is configured', async () => {
  const disabled = createGoogleIdTokenVerifier({ clientId: undefined })
  expect(await disabled.verify(await token())).toBeNull()
})
