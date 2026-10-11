import { isIdentifierWithinLimit } from 'utils'

import type { VersionContext } from '../dao/object.interface.ts'
import { AppError } from '../error.ts'
import type { DesignObject } from '../repository/object.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import {
  assertSequence,
  assertTableDefinition,
  type SequenceDefinition,
  type TableDefinition,
  type ViewDefinition,
} from './definition.ts'
export interface DesignIssue {
  objectKey: string
  path: string
  code: string
  severity: 'error' | 'warning'
  message: string
}
export const validateDesign = async (
  context: VersionContext,
  objects: DesignObject[],
  sql: SqlValidator,
) => {
  const issues: DesignIssue[] = []
  const add = (
    object: DesignObject,
    path: string,
    code: string,
    message: string,
    severity: 'error' | 'warning' = 'error',
  ) => issues.push({ objectKey: object.objectKey, path, code, message, severity })
  const check = async (object: DesignObject, path: string, fn: () => void | Promise<unknown>) => {
    try {
      await fn()
    } catch (error) {
      if (!(error instanceof AppError)) throw error
      add(object, path, 'invalid_definition', error.message)
    }
  }
  const identifier = (object: DesignObject, path: string, name: string) => {
    if (!name.trim() || name.includes('\0') || !isIdentifierWithinLimit(context.target, name))
      add(object, path, 'invalid_name', '物理名がターゲットの規則に合いません')
  }
  for (const object of objects) {
    identifier(object, 'name', object.name)
    if (!object.logicalName)
      add(object, 'logicalName', 'missing_logical_name', '論理名がありません', 'warning')
    const definition = object.definition as { comment?: string | null }
    if (!definition.comment)
      add(object, 'definition.comment', 'missing_comment', 'コメントがありません', 'warning')
    if (
      object.schemaKey &&
      !objects.some((v) => v.kind === 'schema' && v.objectKey === object.schemaKey)
    )
      add(object, 'schemaKey', 'missing_schema', 'スキーマがありません')
    if (object.kind === 'table') {
      const table = object.definition as TableDefinition
      await check(object, 'definition', () => assertTableDefinition(context.target, table))
      if (!table.columns.length)
        add(object, 'definition.columns', 'no_columns', 'カラムがありません')
      if (!table.constraints.some((v) => v.kind === 'primary_key'))
        add(object, 'definition.constraints', 'missing_primary_key', '主キーがありません')
      if (!table.size)
        add(object, 'definition.size', 'missing_size', 'サイズ設計が未入力です', 'warning')
      for (const [index, column] of table.columns.entries()) {
        const path = `definition.columns.${index}`
        identifier(object, `${path}.name`, column.name)
        if (!column.logicalName || !column.comment)
          add(
            object,
            path,
            'missing_column_description',
            'カラムの論理名・コメントがありません',
            'warning',
          )
        await check(object, `${path}.dataType`, () =>
          sql.validateDataType(context.target, column.dataType),
        )
        if (
          column.generation?.kind === 'identity' &&
          !/^(smallint|integer|bigint|int[248])$/i.test(column.dataType)
        )
          add(
            object,
            `${path}.generation`,
            'invalid_identity_type',
            'IDENTITY は整数型だけに指定できます',
          )
        if (column.defaultValue !== null)
          await check(object, `${path}.defaultValue`, () =>
            sql.validateExpression(context.target, column.defaultValue!, []),
          )
        if (column.generation?.kind === 'generated')
          await check(object, `${path}.generation`, () =>
            sql.validateExpression(
              context.target,
              column.generation!.kind === 'generated' ? column.generation!.expression : '',
              table.columns.map((v) => v.name),
            ),
          )
      }
      for (const [index, constraint] of table.constraints.entries()) {
        const path = `definition.constraints.${index}`
        identifier(object, `${path}.name`, constraint.name)
        if (constraint.kind === 'check')
          await check(object, path, () =>
            sql.validateExpression(
              context.target,
              constraint.expression,
              table.columns.map((v) => v.name),
            ),
          )
        if (constraint.kind === 'foreign_key') {
          const reference = objects.find(
            (v) => v.kind === 'table' && v.objectKey === constraint.referenceTableKey,
          )
          const target = reference?.definition as TableDefinition | undefined
          if (
            !target ||
            constraint.referenceColumns.some((key) => !target.columns.some((v) => v.key === key))
          )
            add(object, path, 'missing_reference', '外部キーの参照先がありません')
          else if (
            !target.constraints.some(
              (v) =>
                (v.kind === 'primary_key' || v.kind === 'unique') &&
                v.columns.length === constraint.referenceColumns.length &&
                v.columns.every((key, i) => key === constraint.referenceColumns[i]) &&
                (!('deferrable' in v) || !v.deferrable),
            ) &&
            !target.indexes.some(
              (v) =>
                v.unique &&
                !v.where &&
                v.columns.length === constraint.referenceColumns.length &&
                v.columns.every((key, i) => key.columnKey === constraint.referenceColumns[i]),
            )
          )
            add(object, path, 'reference_not_unique', '参照先に主キー・UNIQUE がありません')
          const covered = [
            ...table.indexes.map((v) => v.columns.map((c) => c.columnKey)),
            ...table.constraints.flatMap((v) =>
              v.kind === 'primary_key' || v.kind === 'unique' ? [v.columns] : [],
            ),
          ].some((cols) => constraint.columns.every((key, i) => key === cols[i]))
          if (!covered)
            add(
              object,
              path,
              'unindexed_foreign_key',
              '外部キーをカバーするインデックスがありません',
              'warning',
            )
        }
      }
      for (const [index, v] of table.indexes.entries()) {
        identifier(object, `definition.indexes.${index}.name`, v.name)
        for (const col of v.columns)
          if (col.expression)
            await check(object, `definition.indexes.${index}`, () =>
              sql.validateExpression(
                context.target,
                col.expression!,
                table.columns.map((c) => c.name),
              ),
            )
        if (v.where)
          await check(object, `definition.indexes.${index}.where`, () =>
            sql.validateExpression(
              context.target,
              v.where!,
              table.columns.map((c) => c.name),
            ),
          )
      }
    } else if (object.kind === 'view' || object.kind === 'materialized_view')
      await check(object, 'definition.select', () =>
        sql.validateView(
          context.target,
          (object.definition as ViewDefinition).select,
          objects.filter((v) => v.objectKey !== object.objectKey),
          object.schemaKey,
        ),
      )
    else if (object.kind === 'sequence') {
      const sequence = object.definition as SequenceDefinition
      await check(object, 'definition', () => assertSequence(sequence))
      if (sequence.ownedBy) {
        const owner = objects.find(
          (v) => v.kind === 'table' && v.objectKey === sequence.ownedBy!.tableKey,
        )
        if (
          !(owner?.definition as TableDefinition | undefined)?.columns.some(
            (v) => v.key === sequence.ownedBy!.columnKey,
          )
        )
          add(object, 'definition.ownedBy', 'missing_owner', '所有カラムがありません')
      }
    }
  }
  return {
    issues,
    errors: issues.filter((v) => v.severity === 'error').length,
    warnings: issues.filter((v) => v.severity === 'warning').length,
  }
}
