import { AppError } from '../error.ts'
import type { ObjectRepository } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { generatePostgresDdl } from './ddl-postgres.ts'
import { generateSqliteDdl } from './ddl-sqlite.ts'
import type { DdlOptions } from './ddl.ts'
import { generatePostgresMigration } from './migration-postgres.ts'
import type { MigrationOptions } from './migration.ts'
import { assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export const createScriptService = (deps: {
  products: ProductRepository
  objects: ObjectRepository
  sql: SqlValidator
}) => {
  const design = async (userId: string, versionId: string) => {
    const context = await deps.objects.findContext(versionId)
    if (!context) throw new AppError('not_found')
    const member = await requireMembership(deps.products, context.productId, userId)
    assertAllowed(member.role, 'exportScripts')
    const scope = await deps.objects.findScope(versionId)
    if (!scope) throw new AppError('not_found')
    return scope
  }
  return {
    migration: async ({
      userId,
      databaseId,
      fromVersionId,
      toVersionId,
      options,
    }: {
      userId: string
      databaseId: string
      fromVersionId: string
      toVersionId: string
      options: MigrationOptions
    }) => {
      const before = await design(userId, fromVersionId),
        after = await design(userId, toVersionId)
      if (
        before.context.version.databaseId !== databaseId ||
        after.context.version.databaseId !== databaseId
      )
        throw new AppError('not_found')
      if (before.context.version.status === 'editing' || after.context.version.status === 'editing')
        throw new AppError('invalid_state')
      if (after.context.target !== 'postgresql18') throw new AppError('invalid_input')
      const result = await generatePostgresMigration(
        after.context,
        before.objects,
        after.objects,
        deps.sql,
        options,
      )
      const base = after.context.databaseName.replace(/[^\p{L}\p{N}_-]/gu, '_')
      return {
        ...result,
        fileName: `${base}_v${before.context.version.number}_to_v${after.context.version.number}.sql`,
        fromVersion: before.context.version,
        toVersion: after.context.version,
      }
    },
    ddl: async ({
      userId,
      versionId,
      options,
    }: {
      userId: string
      versionId: string
      options: DdlOptions
    }) => {
      const scope = await design(userId, versionId)
      if (scope.context.version.status === 'editing') throw new AppError('invalid_state')
      const result = await (
        scope.context.target === 'postgresql18' ? generatePostgresDdl : generateSqliteDdl
      )(scope.context, scope.objects, deps.sql, options)
      const base = scope.context.databaseName.replace(/[^\p{L}\p{N}_-]/gu, '_')
      return {
        ...result,
        fileName: `${base}_v${scope.context.version.number}_build.sql`,
        version: scope.context.version,
        revision: scope.context.version.revision,
      }
    },
  }
}
export type ScriptService = ReturnType<typeof createScriptService>
