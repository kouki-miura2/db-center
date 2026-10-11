const toHex = (bytes: ArrayBuffer): string =>
  Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('')

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

/** A new random session token (32 bytes): sent to the browser in the cookie, never stored. */
export const createSessionToken = (): string =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(32)))

/** What `sessions.id` holds for a token: its SHA-256, so a leaked table can't be used to sign in. */
export const hashSessionToken = async (token: string): Promise<string> =>
  toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))
