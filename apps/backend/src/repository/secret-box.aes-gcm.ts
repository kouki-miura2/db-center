import { AppError } from '../error.ts'
import type { SecretBox } from './secret-box.interface.ts'

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) =>
    char.charCodeAt(0),
  )

const encoder = new TextEncoder()

const unavailable = () =>
  new AppError('invalid_state', {
    message: '暗号鍵が設定されていないため、この操作はできません',
  })

/**
 * AES-256-GCM with a fresh 12-byte nonce per encryption and `purpose:recordId` as additional
 * authenticated data. A ciphertext reads `v1.<key id>.<nonce>.<ciphertext>`; the key ID (first 8
 * hex digits of the key's SHA-256) tells which key it needs, so the key can be rotated later.
 *
 * `base64Key` is 32 random bytes in base64, from the runtime's secret store. Without it, every
 * call throws `invalid_state`, so the features that need it are off rather than storing plaintext.
 */
export const createAesGcmSecretBox = (base64Key: string | undefined): SecretBox => {
  if (!base64Key) {
    return {
      encrypt: async () => {
        throw unavailable()
      },
      decrypt: async () => {
        throw unavailable()
      },
    }
  }
  const raw = fromBase64(base64Key)
  if (raw.length !== 32) throw new Error('The encryption key must be 32 bytes (base64).')
  const keyPromise = crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  const keyIdPromise = crypto.subtle
    .digest('SHA-256', raw)
    .then((hash) =>
      Array.from(new Uint8Array(hash).slice(0, 4), (byte) =>
        byte.toString(16).padStart(2, '0'),
      ).join(''),
    )
  const aad = (purpose: string, recordId: string) => encoder.encode(`${purpose}:${recordId}`)

  return {
    encrypt: async (plaintext, purpose, recordId) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad(purpose, recordId) },
        await keyPromise,
        encoder.encode(plaintext),
      )
      return `v1.${await keyIdPromise}.${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`
    },
    decrypt: async (ciphertext, purpose, recordId) => {
      const [version, keyId, iv, data] = ciphertext.split('.')
      if (version !== 'v1' || keyId !== (await keyIdPromise) || !iv || !data) {
        throw new Error('Unknown ciphertext format or key')
      }
      const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromBase64(iv), additionalData: aad(purpose, recordId) },
        await keyPromise,
        fromBase64(data),
      )
      return new TextDecoder().decode(plaintext)
    },
  }
}
