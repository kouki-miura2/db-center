import { createRemoteJWKSet, type JWTVerifyGetKey, jwtVerify } from 'jose'

import type { GoogleIdTokenVerifier } from './google-id-token.interface.ts'

// Google's public keys; jose caches them and refetches on an unknown key ID.
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))

/**
 * Verifies Google ID tokens as Google's server-side guide requires: signature by Google's keys,
 * `iss` is Google, `aud` is this app's client ID, not expired. Also requires a verified email.
 * With no client ID configured, every token is rejected, so sign-in is safely off.
 */
export const createGoogleIdTokenVerifier = ({
  clientId,
  keys = googleKeys,
}: {
  clientId: string | undefined
  /** Tests pass a local key set. */
  keys?: JWTVerifyGetKey
}): GoogleIdTokenVerifier => ({
  verify: async (idToken) => {
    if (!clientId) return null
    try {
      const { payload } = await jwtVerify(idToken, keys, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: clientId,
        algorithms: ['RS256'],
      })
      if (typeof payload.sub !== 'string' || typeof payload.email !== 'string') return null
      if (payload.email_verified !== true) return null
      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: typeof payload.name === 'string' ? payload.name : null,
      }
    } catch {
      return null
    }
  },
})
