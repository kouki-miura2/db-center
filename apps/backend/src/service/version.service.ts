import type { VersionContext } from '../dao/object.interface.ts'
import type { VersionWrite } from '../dao/version.interface.ts'
import { AppError } from '../error.ts'
import type { DatabaseRepository } from '../repository/database.repository.ts'
import type { DesignObject, ObjectRepository } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import type { VersionRepository } from '../repository/version.repository.ts'
import { validateDesign } from './design-validation.ts'
import { allowedRoles, assertAllowed, type Operation } from './permission.ts'
import { requireMembership } from './product.service.ts'
export interface VersionChangeInput {
  userId: string
  versionId: string
  expectedUpdatedAt: number
  expectedRevision: number
  memo: string | null
}
const designValue = (v: DesignObject) =>
  JSON.stringify({
    kind: v.kind,
    name: v.name,
    logicalName: v.logicalName,
    schemaKey: v.schemaKey,
    definition: v.definition,
  })
export const compareDesigns = (previous: DesignObject[], current: DesignObject[]) => {
  const before = new Map(previous.map((v) => [v.objectKey, v]))
  const after = new Map(current.map((v) => [v.objectKey, v]))
  const counts = { added: 0, changed: 0, deleted: 0 }
  current.forEach((v) => {
    const old = before.get(v.objectKey)
    if (!old) counts.added++
    else if (designValue(old) !== designValue(v)) counts.changed++
  })
  previous.forEach((v) => {
    if (!after.has(v.objectKey)) counts.deleted++
  })
  return counts
}
export const createVersionService = (deps: {
  products: ProductRepository
  databases: DatabaseRepository
  objects: ObjectRepository
  versions: VersionRepository
  sql: SqlValidator
}) => {
  const authorize = async (userId: string, versionId: string, operation: Operation) => {
    const context = await deps.objects.findContext(versionId)
    if (!context) throw new AppError('not_found')
    const membership = await requireMembership(deps.products, context.productId, userId)
    assertAllowed(membership.role, operation)
    return context
  }
  const validate = async (userId: string, versionId: string) => {
    const context = await authorize(userId, versionId, 'view')
    const scope = await deps.objects.findScope(versionId)
    if (!scope) throw new AppError('not_found')
    const checked = await validateDesign(scope.context, scope.objects, deps.sql)
    const database = await deps.databases.findScope(context.productId, context.version.databaseId)
    const previous = database?.versions
      .filter((v) => v.status === 'final' && v.number < context.version.number)
      .toSorted((a, b) => b.number - a.number)[0]
    const before = previous ? ((await deps.objects.findScope(previous.id))?.objects ?? []) : []
    return {
      ...checked,
      revision: scope.context.version.revision,
      updatedAt: scope.context.version.updatedAt,
      changes: compareDesigns(before, scope.objects),
      previousVersionId: previous?.id ?? null,
    }
  }
  const writeInput = (
    context: VersionContext,
    input: VersionChangeInput,
    operation: Operation,
    action: string,
  ): VersionWrite => {
    const now = Date.now()
    return {
      context,
      userId: input.userId,
      allowedRoles: allowedRoles(operation),
      expectedUpdatedAt: input.expectedUpdatedAt,
      expectedRevision: input.expectedRevision,
      now,
      audit: {
        id: crypto.randomUUID(),
        productId: context.productId,
        userId: input.userId,
        targetType: 'version',
        action,
        summary: `${context.databaseName} v${context.version.number}`,
        createdAt: now,
      },
    }
  }
  return {
    validate: ({ userId, versionId }: { userId: string; versionId: string }) =>
      validate(userId, versionId),
    provisional: async (input: VersionChangeInput) => {
      const context = await authorize(input.userId, input.versionId, 'provisionalVersion')
      if (context.version.status !== 'editing') throw new AppError('invalid_state')
      const result = await validate(input.userId, input.versionId)
      if (
        result.revision !== input.expectedRevision ||
        result.updatedAt !== input.expectedUpdatedAt
      )
        throw new AppError('stale_update')
      if (result.errors) return { transitioned: false as const, ...result }
      const saved = await deps.versions.transition({
        ...writeInput(context, input, 'provisionalVersion', 'provisional'),
        to: 'provisional',
        memo: input.memo,
        acknowledgeApplied: false,
      })
      return { transitioned: true as const, ...saved, checks: result }
    },
    revert: async (input: VersionChangeInput & { acknowledgeApplied: boolean }) => {
      const context = await authorize(input.userId, input.versionId, 'revertVersion')
      if (context.version.status !== 'provisional') throw new AppError('invalid_state')
      if (
        context.version.updatedAt !== input.expectedUpdatedAt ||
        context.version.revision !== input.expectedRevision
      )
        throw new AppError('stale_update')
      const applications = await deps.versions.applications(input.versionId)
      if (applications.some((v) => v.status === 'running')) throw new AppError('invalid_state')
      const warning = applications.some((v) => v.status === 'succeeded')
        ? '適用済みの接続先と設計がずれます'
        : null
      if (warning && !input.acknowledgeApplied)
        return {
          transitioned: false as const,
          requiresConfirmation: true as const,
          warning,
          applications,
        }
      return {
        transitioned: true as const,
        ...(await deps.versions.transition({
          ...writeInput(context, input, 'revertVersion', 'revert'),
          to: 'editing',
          memo: input.memo,
          acknowledgeApplied: input.acknowledgeApplied,
        })),
        warning,
      }
    },
  }
}
export type VersionService = ReturnType<typeof createVersionService>
