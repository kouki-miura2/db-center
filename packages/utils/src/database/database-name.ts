/**
 * A database name (`docs/spec.md` "各論 > データベース > 項目"): starts with a lowercase letter,
 * then lowercase letters, digits and `_` only, 63 characters at most. Checked in both the UI and
 * the API.
 */
export const DATABASE_NAME_PATTERN = /^[a-z][a-z0-9_]{0,62}$/

export const isDatabaseName = (value: string): boolean => DATABASE_NAME_PATTERN.test(value)
