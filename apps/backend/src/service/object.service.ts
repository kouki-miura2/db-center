import { isIdentifierWithinLimit, LIMITS } from 'utils'

import type { VersionContext } from '../dao/object.interface.ts'
import { AppError } from '../error.ts'
import type { DesignObject, ObjectRepository } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import { assertTableDefinition, type ObjectInput } from './definition.ts'
import { allowedRoles } from './permission.ts'
import { assertConfirmationName, requireMembership } from './product.service.ts'

export const createObjectService = (deps: {
  products: ProductRepository
  objects: ObjectRepository
}) => {
  const authorize = async (userId: string, versionId: string) => {
    const context = await deps.objects.findContext(versionId)
    if (!context) throw new AppError('not_found')
    await requireMembership(deps.products, context.productId, userId)
    return context
  }
  const write = async (
    userId: string,
    context: VersionContext,
    record: DesignObject,
    expectedUpdatedAt: number | null,
    deleting: boolean,
  ) => {
    if (context.version.status !== 'editing') throw new AppError('invalid_state')
    const now = Date.now()
    return deps.objects.save({
      context,
      userId,
      allowedRoles: allowedRoles('editDesign'),
      record,
      expectedUpdatedAt,
      delete: deleting,
      now,
      maxObjects: LIMITS.objectsPerVersion,
      maxBytes: LIMITS.versionDefinitionBytes,
      audit: {
        id: crypto.randomUUID(),
        productId: context.productId,
        userId,
        targetType: 'object',
        action: deleting ? 'delete' : expectedUpdatedAt === null ? 'create' : 'update',
        summary: `${context.databaseName} v${context.version.number} ${record.name}`,
        createdAt: now,
      },
    })
  }
  return {
    getVersion: async ({
      userId,
      versionId,
      clientRevision,
    }: {
      userId: string
      versionId: string
      clientRevision?: number
    }) => {
      const current = await authorize(userId, versionId)
      if (current.version.revision === clientRevision)
        return { mode: 'unchanged' as const, revision: current.version.revision }
      const scope = await deps.objects.findScope(versionId, clientRevision)
      if (!scope) throw new AppError('not_found')
      const { version } = scope.context
      const delta =
        clientRevision !== undefined &&
        clientRevision >= version.compactedRevision &&
        clientRevision <= version.revision
      const schemaNames = new Map(
        scope.objects.filter((v) => v.kind === 'schema').map((v) => [v.objectKey, v.name]),
      )
      const sorted = scope.objects.toSorted(
        (a, b) =>
          (schemaNames.get(a.schemaKey ?? '') ?? '').localeCompare(
            schemaNames.get(b.schemaKey ?? '') ?? '',
          ) ||
          ['schema', 'table', 'view', 'materialized_view', 'sequence'].indexOf(a.kind) -
            ['schema', 'table', 'view', 'materialized_view', 'sequence'].indexOf(b.kind) ||
          a.name.localeCompare(b.name),
      )
      return delta
        ? {
            mode: 'delta' as const,
            revision: version.revision,
            version,
            upserted: sorted.filter((v) => v.deletedAt === null),
            deletedKeys: sorted.filter((v) => v.deletedAt !== null).map((v) => v.objectKey),
          }
        : { mode: 'full' as const, revision: version.revision, data: { version, objects: sorted } }
    },
    saveObject: async ({
      userId,
      versionId,
      objectKey,
      expectedUpdatedAt,
      input,
    }: {
      userId: string
      versionId: string
      objectKey?: string
      expectedUpdatedAt?: number
      input: ObjectInput
    }) => {
      const context = await authorize(userId, versionId)
      if (!isIdentifierWithinLimit(context.target, input.name) || input.name.includes('\0'))
        throw new AppError('invalid_input')
      if (context.target === 'sqlite3' && input.kind !== 'table')
        throw new AppError('invalid_input')
      if (input.kind === 'table') assertTableDefinition(context.target, input.definition)
      if ((input.kind === 'schema' || context.target === 'sqlite3') !== (input.schemaKey === null))
        throw new AppError('invalid_input')
      if (objectKey && expectedUpdatedAt === undefined) throw new AppError('invalid_input')
      return write(
        userId,
        context,
        {
          ...input,
          id: crypto.randomUUID(),
          objectKey: objectKey ?? crypto.randomUUID(),
          versionId,
          updatedBy: userId,
          updatedAt: 0,
          revision: 0,
          deletedAt: null,
        },
        expectedUpdatedAt ?? null,
        false,
      )
    },
    deleteObject: async ({
      userId,
      versionId,
      objectKey,
      expectedUpdatedAt,
      confirmationName,
    }: {
      userId: string
      versionId: string
      objectKey: string
      expectedUpdatedAt: number
      confirmationName: string
    }) => {
      const context = await authorize(userId, versionId)
      const scope = await deps.objects.findScope(versionId)
      const object = scope?.objects.find((v) => v.objectKey === objectKey)
      if (!object) throw new AppError('not_found')
      assertConfirmationName(confirmationName, object.name)
      return write(userId, context, object, expectedUpdatedAt, true)
    },
  }
}
export type ObjectService = ReturnType<typeof createObjectService>
