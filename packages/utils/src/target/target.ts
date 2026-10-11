import { utf8ByteLength } from '../text/byte-length.ts'

/**
 * The database products a product can target (`docs/spec.md` "参照 > ターゲット一覧"). The key is
 * the value stored in `products.target`.
 */
export const TARGETS = {
  postgresql18: {
    label: 'PostgreSQL 18',
    /** Max length of a physical name, in UTF-8 bytes (`NAMEDATALEN - 1`). */
    identifierMaxBytes: 63,
  },
  sqlite3: {
    label: 'SQLite 3',
    /** SQLite has no limit on the length of a physical name. */
    identifierMaxBytes: null,
  },
} as const satisfies Record<string, { label: string; identifierMaxBytes: number | null }>

export type Target = keyof typeof TARGETS

export const isTarget = (value: unknown): value is Target =>
  typeof value === 'string' && Object.hasOwn(TARGETS, value)

/** Whether a physical name fits the target's length limit. Checked in both the UI and the API. */
export const isIdentifierWithinLimit = (target: Target, name: string): boolean => {
  const max = TARGETS[target].identifierMaxBytes
  return max === null || utf8ByteLength(name) <= max
}
