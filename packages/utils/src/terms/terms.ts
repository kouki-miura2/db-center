/**
 * Current version of the terms of service and privacy policy. Raise it whenever either text
 * changes: a user whose `users.terms_version` differs must agree again before using the app
 * (`docs/spec.md` "共通ルール > 同意"). The UI shows it with the texts and sends it on consent; the
 * API compares it with the stored version.
 */
export const TERMS_VERSION = '2026-10-11'
