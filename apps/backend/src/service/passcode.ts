const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const LENGTH = 8

/**
 * A new invitation passcode: 8 random letters and digits, uppercase ("各論 > プロダクト管理":
 * 英数字、大文字・小文字を区別しない). Bytes ≥ 252 are drawn again so every character is equally
 * likely (252 = 7 × 36).
 */
export const createPasscode = (): string => {
  let code = ''
  while (code.length < LENGTH) {
    for (const byte of crypto.getRandomValues(new Uint8Array(LENGTH))) {
      if (byte < 252 && code.length < LENGTH) code += ALPHABET[byte % ALPHABET.length]
    }
  }
  return code
}

/** Upper case, so the code matches however it is typed. */
export const normalizePasscode = (code: string): string => code.trim().toUpperCase()

/** What `invitations.passcode_hash` holds: the SHA-256 (hex) of the normalized code. */
export const hashPasscode = async (code: string): Promise<string> =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizePasscode(code))),
    ),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('')
