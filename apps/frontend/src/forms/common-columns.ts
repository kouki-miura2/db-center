import { charLength, isIdentifierWithinLimit, LIMITS, type Target } from 'utils'

import type { CommonColumn } from '../composables/useDatabaseQuery.ts'
// Required fields and UI caps for every row, including rows whose detail panel isn't open.
export const commonColumnsReady = (columns: CommonColumn[], target: Target) =>
  columns.every(
    (column) =>
      !!column.name.trim() &&
      isIdentifierWithinLimit(target, column.name.trim()) &&
      charLength(column.name) <= LIMITS.expressionMaxLength &&
      !!column.dataType.trim() &&
      charLength(column.dataType) <= LIMITS.expressionMaxLength &&
      charLength(column.logicalName || '') <= LIMITS.logicalNameMaxLength &&
      charLength(column.comment || '') <= LIMITS.commentMaxLength &&
      charLength(column.defaultValue || '') <= LIMITS.expressionMaxLength &&
      charLength(column.collation || '') <= LIMITS.expressionMaxLength &&
      (column.generation?.kind !== 'generated' ||
        (!!column.generation.expression.trim() &&
          charLength(column.generation.expression) <= LIMITS.expressionMaxLength)),
  )
export const newCommonColumn = (): CommonColumn => ({
  name: '',
  logicalName: null,
  dataType: '',
  notNull: false,
  defaultValue: null,
  comment: null,
  generation: null,
  collation: null,
})
export const copyCommonColumns = (columns: CommonColumn[]): CommonColumn[] =>
  columns.map((column) => ({
    ...column,
    generation: column.generation ? { ...column.generation } : null,
  }))
export const normalizeCommonColumns = (columns: CommonColumn[]): CommonColumn[] =>
  columns.map((column) => ({
    ...column,
    name: column.name.trim(),
    dataType: column.dataType.trim(),
    logicalName: column.logicalName?.trim() || null,
    defaultValue: column.defaultValue?.trim() || null,
    comment: column.comment?.trim() || null,
    collation: column.collation?.trim() || null,
    generation:
      column.generation?.kind === 'generated'
        ? { ...column.generation, expression: column.generation.expression.trim() }
        : column.generation,
  }))
