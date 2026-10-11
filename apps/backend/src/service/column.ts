import { isIdentifierWithinLimit, LIMITS, type Target, TARGETS } from 'utils'
import { z } from 'zod'

import { AppError, type ErrorFields } from '../error.ts'
import { text } from '../validation.ts'

/*
 * A column of a design: a table's column, or one of a database's common columns (which have the
 * same shape, "各論 > データベース > 共通カラム"), with the fields of the column editor. Whether
 * a data type or an expression is valid is checked with the rest of the design, not here.
 */

const expression = z.string().trim().min(1).max(LIMITS.expressionMaxLength)

export const columnSchema = z.strictObject({
  name: expression,
  logicalName: text(LIMITS.logicalNameMaxLength).nullable(),
  /** With its length or precision, e.g. `varchar(16)`, `numeric(10, 2)`, `INTEGER`. */
  dataType: expression,
  notNull: z.boolean(),
  defaultValue: expression.nullable(),
  comment: text(LIMITS.commentMaxLength).nullable(),
  /** PostgreSQL 18: `GENERATED ... AS IDENTITY`. SQLite 3: a generated column only. */
  generation: z
    .discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('identity'), always: z.boolean() }),
      z.strictObject({ kind: z.literal('generated'), expression, stored: z.boolean() }),
    ])
    .nullable(),
  collation: expression.nullable(),
  /** PostgreSQL 18 only. */
  storage: z.enum(['plain', 'external', 'extended', 'main']).nullable().optional(),
  /** PostgreSQL 18 only. */
  compression: z.enum(['pglz', 'lz4']).nullable().optional(),
  /** SQLite 3 only: an `INTEGER PRIMARY KEY` that never reuses a deleted row's ID. */
  autoincrement: z.boolean().optional(),
})

export type Column = z.infer<typeof columnSchema>

const SQLITE_COLLATIONS = ['BINARY', 'NOCASE', 'RTRIM']

// The problems of one column on a target, by field.
const columnProblems = (target: Target, column: Column): Record<string, string> => {
  const problems: Record<string, string> = {}
  if (!isIdentifierWithinLimit(target, column.name)) {
    problems.name = `${TARGETS[target].identifierMaxBytes}バイト以内で入力してください`
  }
  if (column.generation && column.defaultValue !== null) {
    problems.defaultValue = '値を生成するカラムにはデフォルト値を指定できません'
  }
  if (target === 'postgresql18') {
    if (column.autoincrement !== undefined) problems.autoincrement = 'この項目は指定できません'
  } else {
    if (column.generation?.kind === 'identity') {
      problems.generation = 'SQLite 3 では IDENTITY を指定できません'
    }
    if (column.storage !== undefined) problems.storage = 'この項目は指定できません'
    if (column.compression !== undefined) problems.compression = 'この項目は指定できません'
    if (column.collation !== null && !SQLITE_COLLATIONS.includes(column.collation)) {
      problems.collation = `${SQLITE_COLLATIONS.join(' / ')} のいずれかを指定してください`
    }
  }
  return problems
}

/**
 * Throws `invalid_input` with per-field messages (`<path>.<index>.<field>`) unless the columns fit
 * the target and their names are unique.
 */
export const assertColumns = (target: Target, columns: Column[], path: string): void => {
  const fields: ErrorFields = {}
  const seen = new Set<string>()
  columns.forEach((column, index) => {
    const problems = columnProblems(target, column)
    if (seen.has(column.name)) problems.name ??= '同じ名前のカラムがあります'
    seen.add(column.name)
    Object.entries(problems).forEach(([field, message]) => {
      fields[`${path}.${index}.${field}`] = message
    })
  })
  if (Object.keys(fields).length > 0) throw new AppError('invalid_input', { fields })
}
