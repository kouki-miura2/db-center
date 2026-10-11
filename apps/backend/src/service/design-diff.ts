import type { Target } from 'utils'

import type { DesignObject } from '../repository/object.repository.ts'
import type { TableDefinition } from './definition.ts'

/** Property order is incidental; array order is meaningful unless sorted by a stable key. */
export const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
export const sameValue = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const keyed = <T extends { key: string }>(items: T[]) =>
  items.toSorted((a, b) => a.key.localeCompare(b.key))
export const designValue = (object: DesignObject) => ({
  kind: object.kind,
  name: object.name,
  logicalName: object.logicalName,
  schemaKey: object.schemaKey,
  definition:
    object.kind === 'table'
      ? {
          ...(object.definition as TableDefinition),
          constraints: keyed((object.definition as TableDefinition).constraints),
          indexes: keyed((object.definition as TableDefinition).indexes),
        }
      : object.definition,
})
/** All fields represented in the database, excluding documentation and migration preferences. */
export const physicalTable = (object: DesignObject) => {
  const table = object.definition as TableDefinition
  return {
    name: object.name,
    schemaKey: object.schemaKey,
    columns: table.columns.map(
      ({ logicalName: _logicalName, comment: _comment, ...column }) => column,
    ),
    constraints: keyed(table.constraints),
    indexes: keyed(table.indexes).map(({ concurrently: _concurrently, ...index }) => index),
    options: table.options,
  }
}
export interface DesignChange {
  objectKey: string
  kind: DesignObject['kind']
  entity: 'object' | 'column' | 'constraint' | 'index' | 'column_order'
  key: string
  action: 'added' | 'changed' | 'deleted' | 'renamed'
  before: unknown
  after: unknown
  fields: string[]
  impact: { dataLoss: boolean; recreation: boolean; outsideTransaction: boolean }
}
const widening = (before: string, after: string) => {
  const ranks: Record<string, number> = {
    smallint: 0,
    int2: 0,
    integer: 1,
    int: 1,
    int4: 1,
    bigint: 2,
    int8: 2,
  }
  const a = ranks[before.trim().toLowerCase()],
    b = ranks[after.trim().toLowerCase()]
  return a !== undefined && b !== undefined && b >= a
}
export const diffDesigns = (previous: DesignObject[], current: DesignObject[], target: Target) => {
  const before = new Map(previous.filter((v) => v.deletedAt === null).map((v) => [v.objectKey, v]))
  const after = new Map(current.filter((v) => v.deletedAt === null).map((v) => [v.objectKey, v]))
  const changes: DesignChange[] = [],
    counts = { added: 0, changed: 0, deleted: 0 }
  const add = (
    object: DesignObject,
    entity: DesignChange['entity'],
    key: string,
    old: unknown,
    next: unknown,
  ) => {
    if (sameValue(old, next)) return
    const a = old as Record<string, unknown> | null,
      b = next as Record<string, unknown> | null
    const fields = [...new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})])]
      .filter((field) => !sameValue(a?.[field], b?.[field]))
      .sort()
    const action =
      old === null
        ? 'added'
        : next === null
          ? 'deleted'
          : fields.includes('name')
            ? 'renamed'
            : 'changed'
    const dataLoss =
      (action === 'deleted' &&
        (entity === 'column' ||
          (entity === 'object' && ['table', 'sequence'].includes(object.kind)))) ||
      (entity === 'column' &&
        old !== null &&
        next !== null &&
        fields.includes('dataType') &&
        !widening(String(a?.dataType), String(b?.dataType))) ||
      (entity === 'column' &&
        old !== null &&
        next !== null &&
        fields.includes('generation') &&
        b?.generation !== null &&
        b?.generation !== undefined)
    const recreation =
      entity === 'column_order' ||
      (target === 'sqlite3' &&
        object.kind === 'table' &&
        entity !== 'object' &&
        entity !== 'index' &&
        fields.some((v) => !['comment', 'logicalName'].includes(v))) ||
      (entity === 'object' &&
        ['view', 'materialized_view'].includes(object.kind) &&
        action !== 'added' &&
        action !== 'deleted') ||
      (entity === 'column' && fields.some((v) => ['generation', 'collation'].includes(v)))
    const outsideTransaction =
      target === 'postgresql18' &&
      entity === 'index' &&
      (a?.concurrently === true || b?.concurrently === true)
    changes.push({
      objectKey: object.objectKey,
      kind: object.kind,
      entity,
      key,
      action,
      before: old,
      after: next,
      fields,
      impact: { dataLoss, recreation, outsideTransaction },
    })
  }
  for (const key of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(key),
      next = after.get(key),
      object = next ?? old!
    if (!old || !next) {
      counts[old ? 'deleted' : 'added']++
      add(object, 'object', key, old ? designValue(old) : null, next ? designValue(next) : null)
      continue
    }
    if (sameValue(designValue(old), designValue(next))) continue
    counts.changed++
    if (old.kind !== 'table' || next.kind !== 'table') {
      add(object, 'object', key, designValue(old), designValue(next))
      continue
    }
    const a = old.definition as TableDefinition,
      b = next.definition as TableDefinition
    const header = (v: DesignObject, t: TableDefinition) => ({
      name: v.name,
      schemaKey: v.schemaKey,
      logicalName: v.logicalName,
      comment: t.comment,
      options: t.options,
      size: t.size,
    })
    add(object, 'object', key, header(old, a), header(next, b))
    for (const [entity, left, right] of [
      ['column', a.columns, b.columns],
      ['constraint', a.constraints, b.constraints],
      ['index', a.indexes, b.indexes],
    ] as const) {
      const l = new Map(left.map((v) => [v.key, v])),
        r = new Map(right.map((v) => [v.key, v]))
      for (const childKey of [...new Set([...l.keys(), ...r.keys()])].sort())
        add(object, entity, childKey, l.get(childKey) ?? null, r.get(childKey) ?? null)
    }
    const common = new Set(
      a.columns.filter((v) => b.columns.some((c) => c.key === v.key)).map((v) => v.key),
    )
    const l = a.columns.filter((v) => common.has(v.key)).map((v) => v.key),
      r = b.columns.filter((v) => common.has(v.key)).map((v) => v.key)
    if (!sameValue(l, r)) add(object, 'column_order', key, l, r)
  }
  return {
    counts,
    changes,
    impact: {
      dataLoss: changes.some((v) => v.impact.dataLoss),
      recreation: changes.some((v) => v.impact.recreation),
      outsideTransaction: changes.some((v) => v.impact.outsideTransaction),
    },
  }
}
