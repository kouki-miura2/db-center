import { z } from 'zod'

import type { DesignObject } from '../repository/object.repository.ts'
import { quoteIdentifier as q } from './ddl.ts'
import type { TableDefinition } from './definition.ts'
import { diffDesigns } from './design-diff.ts'

export const migrationOptionsSchema = z.strictObject({
  indexesConcurrently: z.boolean().default(false),
  constraintsNotValid: z.boolean().default(false),
  lockTimeoutMs: z.number().int().nonnegative().max(2147483647).nullable().default(null),
  includeDrops: z.boolean().default(true),
})
export type MigrationOptions = z.infer<typeof migrationOptionsSchema>
export const temporaryName = (key: string, purpose: string) =>
  `_dbcenter_${purpose}_${key.replaceAll('-', '')}`
export const copyColumns = (before: DesignObject, after: DesignObject, cast = true) => {
  const old = before.definition as TableDefinition,
    next = after.definition as TableDefinition
  const columns = next.columns.filter(
    (v) => v.generation?.kind !== 'generated' && old.columns.some((c) => c.key === v.key),
  )
  if (!columns.length) {
    const column = next.columns.find((v) => v.generation?.kind !== 'generated')!
    return {
      columns: q(column.name),
      values: column.defaultValue === null ? 'NULL' : `(${column.defaultValue})`,
    }
  }
  return {
    columns: columns.map((v) => q(v.name)).join(', '),
    values: columns
      .map((v) => {
        const column = old.columns.find((c) => c.key === v.key)!
        return cast && column.dataType !== v.dataType
          ? `CAST(${q(column.name)} AS ${v.dataType})`
          : q(column.name)
      })
      .join(', '),
  }
}
/** Omitting logical deletions is an explicit, non-converging export choice. */
export const migrationTarget = (
  before: DesignObject[],
  after: DesignObject[],
  target: 'postgresql18' | 'sqlite3',
  options: MigrationOptions,
) => {
  before = before.filter((v) => v.deletedAt === null)
  after = after.filter((v) => v.deletedAt === null)
  const difference = diffDesigns(before, after, target)
  if (options.includeDrops)
    return { objects: after, difference, warnings: [] as string[], complete: true }
  const deleted = new Set(
    difference.changes.filter((v) => v.action === 'deleted').map((v) => v.objectKey),
  )
  // Skip a whole changed object when it removes a child; constraints and references must stay coherent.
  const objects = after.map((v) =>
    deleted.has(v.objectKey) ? before.find((o) => o.objectKey === v.objectKey)! : v,
  )
  objects.push(...before.filter((v) => !after.some((o) => o.objectKey === v.objectKey)))
  const warnings = deleted.size
    ? ['DROP を除外したため削除を伴う変更は適用しません。更新後の設計との一致は保証されません。']
    : []
  return { objects, difference, warnings, complete: deleted.size === 0 }
}
