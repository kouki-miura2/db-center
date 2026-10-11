/** The Google account behind a verified ID token. */
export interface GoogleIdentity {
  /** Stable account ID (`sub`): identifies the user, not the email. */
  sub: string
  /** Verified email address. */
  email: string
  /** Display name from the Google profile, if any (a suggestion for the user name). */
  name: string | null
}

export interface GoogleIdTokenVerifier {
  /** The identity if the token is valid for this app (signature, issuer, audience, expiry, verified email); null otherwise. */
  verify: (idToken: string) => Promise<GoogleIdentity | null>
}
