import { estimateTableSize, LIMITS } from 'utils'
import { z } from 'zod'

import { AppError } from '../error.ts'
import type { DatabaseRepository } from '../repository/database.repository.ts'
import type { DesignObject, ObjectRepository } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SqlValidator, ViewAnalysis } from '../repository/sql-validator.interface.ts'
import { generatePostgresDdl } from './ddl-postgres.ts'
import { generateSqliteDdl } from './ddl-sqlite.ts'
import { ddlOptionsSchema } from './ddl.ts'
import { objectInputSchema, type TableDefinition } from './definition.ts'
import { diffDesigns } from './design-diff.ts'
import { assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export const definitionSectionsSchema = z.strictObject({
  cover: z.boolean().default(true),
  history: z.boolean().default(true),
  tableList: z.boolean().default(true),
  columns: z.boolean().default(true),
  constraints: z.boolean().default(true),
  indexes: z.boolean().default(true),
  size: z.boolean().default(true),
  viewsSequences: z.boolean().default(true),
  ddl: z.boolean().default(false),
  revisions: z.boolean().default(true),
})
export const definitionExportSchema = z.strictObject({
  schemaKeys: z.array(z.uuid()).max(LIMITS.objectsPerVersion).min(1).optional(),
  sections: definitionSectionsSchema.default(() => definitionSectionsSchema.parse({})),
  compareVersionId: z.uuid().nullable().default(null),
  ddlOptions: ddlOptionsSchema.default(() => ddlOptionsSchema.parse({})),
})
export type DefinitionExportInput = z.infer<typeof definitionExportSchema>
const errorData = (error: unknown) => {
  if (!(error instanceof AppError) && !(error instanceof RangeError)) throw error
  return {
    code: error instanceof AppError ? error.code : 'invalid_input',
    message: error.message,
    ...(error instanceof AppError && error.fields ? { fields: error.fields } : {}),
  }
}
export const createDefinitionExportService = (deps: {
  products: ProductRepository
  databases: DatabaseRepository
  objects: ObjectRepository
  sql: SqlValidator
}) => ({
  export: async ({
    userId,
    versionId,
    ...input
  }: DefinitionExportInput & { userId: string; versionId: string }) => {
    const context = await deps.objects.findContext(versionId)
    if (!context) throw new AppError('not_found')
    const member = await requireMembership(deps.products, context.productId, userId)
    assertAllowed(member.role, 'exportDefinition')
    const scope = await deps.objects.findScope(versionId)
    if (!scope) throw new AppError('not_found')
    const objects = scope.objects
      .filter((v) => v.deletedAt === null)
      .map((v) => ({
        ...v,
        ...objectInputSchema.parse({
          kind: v.kind,
          name: v.name,
          logicalName: v.logicalName,
          schemaKey: v.schemaKey,
          definition: v.definition,
        }),
      }))
    const schemas = objects.filter((v) => v.kind === 'schema')
    const schemaKeys = input.schemaKeys ?? schemas.map((v) => v.objectKey)
    if (
      new Set(schemaKeys).size !== schemaKeys.length ||
      schemaKeys.some((key) => !schemas.some((v) => v.objectKey === key))
    )
      throw new AppError('invalid_input', {
        fields: { schemaKeys: 'このバージョンのスキーマを指定してください' },
      })
    const includes = (v: DesignObject) =>
      !input.schemaKeys ||
      schemaKeys.includes(v.kind === 'schema' ? v.objectKey : (v.schemaKey ?? ''))
    const selected = objects
      .filter(includes)
      .toSorted(
        (a, b) =>
          (schemas.find((s) => s.objectKey === a.schemaKey)?.name ?? '').localeCompare(
            schemas.find((s) => s.objectKey === b.schemaKey)?.name ?? '',
          ) || a.name.localeCompare(b.name),
      )
    let comparison: {
      version: typeof scope.context.version
      difference: ReturnType<typeof diffDesigns>
    } | null = null
    if (input.compareVersionId) {
      const otherContext = await deps.objects.findContext(input.compareVersionId)
      if (!otherContext || otherContext.version.databaseId !== scope.context.version.databaseId)
        throw new AppError('not_found')
      const other =
        input.compareVersionId === versionId
          ? scope
          : await deps.objects.findScope(input.compareVersionId)
      if (!other) throw new AppError('not_found')
      const previous = other.objects
        .filter((v) => v.deletedAt === null)
        .map((v) => ({
          ...v,
          ...objectInputSchema.parse({
            kind: v.kind,
            name: v.name,
            logicalName: v.logicalName,
            schemaKey: v.schemaKey,
            definition: v.definition,
          }),
        }))
      const difference = diffDesigns(previous, objects, scope.context.target)
      // Include deletions and moves from or to selected schemas.
      const keys = new Set([...previous.filter(includes), ...selected].map((v) => v.objectKey))
      difference.changes = difference.changes.filter((v) => keys.has(v.objectKey))
      difference.counts = {
        added: new Set(
          difference.changes
            .filter((v) => v.entity === 'object' && v.action === 'added')
            .map((v) => v.objectKey),
        ).size,
        deleted: new Set(
          difference.changes
            .filter((v) => v.entity === 'object' && v.action === 'deleted')
            .map((v) => v.objectKey),
        ).size,
        changed: new Set(
          difference.changes
            .filter(
              (v) => !(v.entity === 'object' && (v.action === 'added' || v.action === 'deleted')),
            )
            .map((v) => v.objectKey),
        ).size,
      }
      difference.impact = {
        dataLoss: difference.changes.some((v) => v.impact.dataLoss),
        recreation: difference.changes.some((v) => v.impact.recreation),
        outsideTransaction: difference.changes.some((v) => v.impact.outsideTransaction),
      }
      comparison = { version: other.context.version, difference }
    }
    const sections = input.sections
    const tableObjects = selected.filter((v) => v.kind === 'table')
    const schemaInfo = (v: DesignObject) => {
      const schema = schemas.find((s) => s.objectKey === v.schemaKey)
      return schema ? { key: schema.objectKey, name: schema.name } : null
    }
    const columnNames = (table: TableDefinition, keys: string[]) =>
      keys.map((key) => table.columns.find((v) => v.key === key)?.name ?? null)
    const tables = tableObjects.map((object) => {
      const table = object.definition,
        size = (() => {
          if (!sections.size || !table.size) return null
          try {
            return {
              input: table.size,
              estimate: estimateTableSize(scope.context.target, table, table.size),
              error: null,
            }
          } catch (error) {
            return { input: table.size, estimate: null, error: errorData(error) }
          }
        })()
      return {
        objectKey: object.objectKey,
        name: object.name,
        logicalName: object.logicalName,
        schema: schemaInfo(object),
        comment: table.comment,
        options: table.options,
        columns: sections.columns ? table.columns : [],
        constraints: sections.constraints
          ? table.constraints.map((constraint) => {
              const target =
                constraint.kind === 'foreign_key'
                  ? objects.find(
                      (v) => v.kind === 'table' && v.objectKey === constraint.referenceTableKey,
                    )
                  : undefined
              return {
                ...constraint,
                columnNames: 'columns' in constraint ? columnNames(table, constraint.columns) : [],
                reference:
                  target?.kind === 'table' && constraint.kind === 'foreign_key'
                    ? {
                        objectKey: target.objectKey,
                        name: target.name,
                        schema: schemaInfo(target),
                        columnNames: columnNames(target.definition, constraint.referenceColumns),
                      }
                    : null,
              }
            })
          : [],
        indexes: sections.indexes
          ? table.indexes.map((index) => ({
              ...index,
              columnNames: index.columns.map((v) =>
                v.columnKey ? columnNames(table, [v.columnKey])[0] : null,
              ),
              includeNames: columnNames(table, index.include),
            }))
          : [],
        size,
      }
    })
    const otherObjects = await Promise.all(
      (sections.viewsSequences
        ? selected.filter((v) => ['view', 'materialized_view', 'sequence'].includes(v.kind))
        : []
      ).map(async (object) => {
        let analysis: ViewAnalysis | null = null,
          error: ReturnType<typeof errorData> | null = null
        if (object.kind === 'view' || object.kind === 'materialized_view') {
          try {
            analysis = await deps.sql.validateView(
              scope.context.target,
              object.definition.select,
              objects.filter((v) => v.objectKey !== object.objectKey),
              object.schemaKey,
            )
          } catch (cause) {
            error = errorData(cause)
          }
        }
        const owner = object.kind === 'sequence' ? object.definition.ownedBy : null
        const ownerTable = owner
          ? objects.find((v) => v.kind === 'table' && v.objectKey === owner.tableKey)
          : null
        return {
          objectKey: object.objectKey,
          kind: object.kind,
          name: object.name,
          logicalName: object.logicalName,
          schema: schemaInfo(object),
          definition: object.definition,
          analysis,
          error,
          ownership:
            ownerTable?.kind === 'table' && owner
              ? {
                  tableName: ownerTable.name,
                  schema: schemaInfo(ownerTable),
                  columnName: columnNames(ownerTable.definition, [owner.columnKey])[0],
                }
              : null,
        }
      }),
    )
    let ddl:
      | { status: 'success'; sql: string; warnings: string[] }
      | { status: 'error'; error: ReturnType<typeof errorData> }
      | null = null
    if (sections.ddl) {
      try {
        // A scoped appendix retains cross-schema references; incomplete dependency selection is an explicit error.
        const result = await (
          scope.context.target === 'postgresql18' ? generatePostgresDdl : generateSqliteDdl
        )(scope.context, selected, deps.sql, input.ddlOptions)
        ddl = { status: 'success', sql: result.sql, warnings: result.warnings }
      } catch (error) {
        ddl = { status: 'error', error: errorData(error) }
      }
    }
    const databaseScope = await deps.databases.findScope(
      scope.context.productId,
      scope.context.version.databaseId,
    )
    if (!databaseScope) throw new AppError('not_found')
    const base = scope.context.databaseName.replace(/[^\p{L}\p{N}_-]/gu, '_')
    return {
      metadata: {
        database: databaseScope.database,
        productId: scope.context.productId,
        target: scope.context.target,
        version: scope.context.version,
        draft: scope.context.version.status === 'editing',
        revision: scope.context.version.revision,
        fileNameBase: `${base}_v${scope.context.version.number}_definition`,
        cover: sections.cover
          ? {
              title: `${scope.context.databaseName} テーブル定義書`,
              versionNumber: scope.context.version.number,
              memo: scope.context.version.memo,
            }
          : null,
      },
      scope: {
        allSchemas: !input.schemaKeys,
        schemaKeys,
        schemas: selected
          .filter((v) => v.kind === 'schema')
          .map((v) => ({
            objectKey: v.objectKey,
            name: v.name,
            logicalName: v.logicalName,
            definition: v.definition,
          })),
      },
      sections,
      history: sections.history
        ? databaseScope.versions
            .toSorted((a, b) => b.number - a.number)
            .map((v) => (v.id === versionId ? scope.context.version : v))
        : [],
      tableList: sections.tableList
        ? tableObjects.map((v) => ({
            objectKey: v.objectKey,
            name: v.name,
            logicalName: v.logicalName,
            schema: schemaInfo(v),
            columnCount: v.definition.columns.length,
          }))
        : [],
      tables:
        sections.columns || sections.constraints || sections.indexes || sections.size ? tables : [],
      otherObjects,
      comparison: sections.revisions ? comparison : null,
      ddl,
    }
  },
})
export type DefinitionExportService = ReturnType<typeof createDefinitionExportService>
