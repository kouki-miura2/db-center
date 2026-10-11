import type { DesignObject } from '../repository/object.repository.ts'
import type { AppliedVersion } from '../repository/postgres.interface.ts'
import { canonical, designValue } from './design-diff.ts'

export const hashText = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('')
export const designHash = (objects: DesignObject[]) =>
  hashText(
    canonical(
      objects
        .filter((v) => v.deletedAt === null)
        .toSorted((a, b) => a.objectKey.localeCompare(b.objectKey))
        .map((v) => ({ key: v.objectKey, ...designValue(v) })),
    ),
  )
export const compareCatalogs = (expected: unknown, actual: Record<string, unknown>) => {
  if (!expected || typeof expected !== 'object' || Array.isArray(expected))
    return { verifiable: false, changes: [], count: null }
  const before = expected as Record<string, unknown>
  const changes = [...new Set([...Object.keys(before), ...Object.keys(actual)])]
    .sort()
    .filter((key) => canonical(before[key]) !== canonical(actual[key]))
    .map((key) => ({
      key,
      action: !(key in before) ? 'added' : !(key in actual) ? 'deleted' : 'changed',
    }))
  return { verifiable: true, changes, count: changes.length }
}
export const matchesAppliedDesign = (
  applied: AppliedVersion | null,
  expected: {
    databaseId: string
    versionId: string
    revision: number
    designHash: string
  },
) =>
  !!applied &&
  applied.databaseId === expected.databaseId &&
  applied.versionId === expected.versionId &&
  applied.revision === expected.revision &&
  applied.designHash === expected.designHash
