/** What a secret is for: part of the authenticated data, so a ciphertext only opens for its own use. */
export type SecretPurpose = 'connection-password' | 'invitation-passcode'

/**
 * Encrypts secrets stored in the database (connection passwords, invitation passcodes). A
 * ciphertext is bound to its purpose and its record's ID, so it can't be moved to another row or
 * use and still decrypt.
 */
export interface SecretBox {
  encrypt: (plaintext: string, purpose: SecretPurpose, recordId: string) => Promise<string>
  decrypt: (ciphertext: string, purpose: SecretPurpose, recordId: string) => Promise<string>
}
