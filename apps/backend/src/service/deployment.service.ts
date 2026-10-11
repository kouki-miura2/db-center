import { z } from 'zod'

import type { ConnectionRecord } from '../dao/connection.interface.ts'
import type { DeploymentRecord } from '../dao/deployment.interface.ts'
import { AppError } from '../error.ts'
import type { ConnectionRepository } from '../repository/connection.repository.ts'
import type {
  DeploymentStorage,
  DeploymentWorkflow,
} from '../repository/deployment-runtime.interface.ts'
import { deploymentView, type DeploymentRepository } from '../repository/deployment.repository.ts'
import type { ObjectRepository } from '../repository/object.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import type { SqlValidator } from '../repository/sql-validator.interface.ts'
import { generatePostgresDdl } from './ddl-postgres.ts'
import { ddlOptionsSchema, normalizedDesign, sqlLiteral, type SqlStep } from './ddl.ts'
import { canonical } from './design-diff.ts'
import { designHash, hashText } from './drift.ts'
import type { InspectionService } from './inspection.service.ts'
import { allowedRoles, assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export const deploymentPreviewSchema = z.strictObject({
  kind: z.enum(['build', 'migration']),
  toVersionId: z.uuid(),
  fromVersionId: z.uuid().optional(),
  expectedRevision: z.number().int().nonnegative(),
})
export const deploymentRequestSchema = deploymentPreviewSchema.extend({ idempotencyKey: z.uuid() })
export type DeploymentInput = z.infer<typeof deploymentPreviewSchema> & {
  userId: string
  connectionId: string
}
export interface DeploymentPlan {
  kind: 'build' | 'migration'
  databaseId: string
  productId: string
  target: { versionId: string; revision: number; designHash: string }
  source: { versionId: string; revision: number; designHash: string } | null
  steps: SqlStep[]
  sql: string
}
export const createDeploymentService = (deps: {
  products: ProductRepository
  connections: ConnectionRepository
  objects: ObjectRepository
  deployments: DeploymentRepository
  sql: SqlValidator
  inspection: InspectionService
  storage?: DeploymentStorage
  workflow?: DeploymentWorkflow
}) => {
  const authorize = async (userId: string, connectionId: string) => {
    const connection = await deps.connections.findCredentials(connectionId)
    if (!connection) throw new AppError('not_found')
    const member = await requireMembership(deps.products, connection.productId, userId)
    assertAllowed(member.role, 'deploy')
    if (member.product.target !== 'postgresql18') throw new AppError('invalid_input')
    return connection
  }
  const prepare = async (input: DeploymentInput, connection: ConnectionRecord) => {
    const scope = await deps.objects.findScope(input.toVersionId)
    if (!scope || scope.context.productId !== connection.productId) throw new AppError('not_found')
    if (scope.context.version.status === 'editing') throw new AppError('invalid_state')
    if (scope.context.version.revision !== input.expectedRevision)
      throw new AppError('stale_update')
    if (input.kind !== 'build' || input.fromVersionId) throw new AppError('invalid_state')
    const objects = await normalizedDesign(scope.context, scope.objects, deps.sql)
    const generated = await generatePostgresDdl(
      scope.context,
      objects,
      deps.sql,
      ddlOptionsSchema.parse({ versionTable: true }),
    )
    const plan: DeploymentPlan = {
      kind: input.kind,
      databaseId: scope.context.version.databaseId,
      productId: connection.productId,
      target: {
        versionId: input.toVersionId,
        revision: input.expectedRevision,
        designHash: await designHash(objects),
      },
      source: null,
      steps: generated.steps,
      sql: generated.sql,
    }
    const inspection = await deps.inspection.inspect({
      userId: input.userId,
      connectionId: input.connectionId,
    })
    const reasons = [
      ...(!deps.storage || !deps.workflow ? ['not_configured'] : []),
      ...(!inspection.supported ? ['unsupported_postgres'] : []),
      ...(!inspection.empty ? ['database_not_empty'] : []),
    ]
    return { plan, inspection, reasons }
  }
  return {
    get: async ({ userId, deploymentId }: { userId: string; deploymentId: string }) => {
      const record = await deps.deployments.findById(deploymentId)
      if (!record || !(await deps.objects.findContext(record.toVersionId)))
        throw new AppError('not_found')
      await requireMembership(deps.products, record.productId, userId)
      return deploymentView(record)
    },
    preview: async (input: DeploymentInput) => {
      const connection = await authorize(input.userId, input.connectionId)
      const { plan, inspection, reasons } = await prepare(input, connection)
      return {
        canExecute: reasons.length === 0,
        reasons,
        inspection,
        sql: plan.sql,
        steps: plan.steps.map(({ sql: _sql, ...step }) => step),
        target: plan.target,
      }
    },
    accept: async (input: DeploymentInput & { idempotencyKey: string }) => {
      const connection = await authorize(input.userId, input.connectionId)
      const requestHash = await hashText(
        canonical({
          kind: input.kind,
          toVersionId: input.toVersionId,
          fromVersionId: input.fromVersionId ?? null,
          expectedRevision: input.expectedRevision,
        }),
      )
      const existing = await deps.deployments.findByKey(input.connectionId, input.idempotencyKey)
      if (existing) {
        if (existing.requestHash !== requestHash) throw new AppError('invalid_state')
        return deploymentView(existing)
      }
      if (!deps.storage || !deps.workflow)
        throw new AppError('invalid_state', {
          message: '自動実行用の保存先とWorkflowが設定されていません',
        })
      const { plan, reasons } = await prepare(input, connection)
      if (reasons.length)
        throw new AppError('invalid_state', { message: '接続先の事前チェックに合格しませんでした' })
      const now = Date.now(),
        id = crypto.randomUUID()
      const setting = `SET dbcenter.deployment_id TO ${sqlLiteral(id)};`
      plan.steps.unshift({
        objectKey: null,
        sql: setting,
        transactional: false,
        beforeTransaction: true,
      })
      plan.sql = setting + '\n\n' + plan.sql
      const serialized = JSON.stringify(plan)
      const record: DeploymentRecord = {
        id,
        productId: plan.productId,
        databaseId: plan.databaseId,
        connectionId: input.connectionId,
        connectionName: connection.name,
        kind: input.kind,
        fromVersionId: input.fromVersionId ?? null,
        toVersionId: input.toVersionId,
        status: 'running',
        phase: 'preparing',
        executedBy: input.userId,
        startedAt: now,
        finishedAt: null,
        log: null,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        planHash: await hashText(serialized),
        connectionSnapshot: JSON.stringify(connection),
        targetRevision: plan.target.revision,
        sourceRevision: plan.source?.revision ?? null,
        executedCount: 0,
      }
      try {
        await deps.deployments.accept({
          record,
          userId: input.userId,
          allowedRoles: allowedRoles('deploy'),
          connectionUpdatedAt: connection.updatedAt,
          audit: {
            id: crypto.randomUUID(),
            productId: plan.productId,
            userId: input.userId,
            targetType: 'deployment',
            action: 'started',
            summary: connection.name,
            createdAt: now,
          },
        })
      } catch (error) {
        const raced = await deps.deployments.findByKey(input.connectionId, input.idempotencyKey)
        if (raced && raced.requestHash === requestHash) return deploymentView(raced)
        throw error
      }
      try {
        await deps.storage.putOnce(`deployments/${id}.sql`, plan.sql)
        await deps.storage.putOnce(`deployments/${id}.json`, serialized)
        if (!(await deps.deployments.queue(id))) throw new AppError('invalid_state')
      } catch {
        await deps.deployments.finish(
          id,
          'failed',
          JSON.stringify({ code: 'preparation_failed', requiresInspection: true }),
          Date.now(),
        )
      }
      if ((await deps.deployments.findById(id))?.phase === 'queued') {
        // An acknowledgement can be lost after creation. Keep queued for reconciliation;
        // never create a second execution or mark an actually started workflow failed.
        try {
          await deps.workflow.start(id)
        } catch {
          /* step 8 reconciles by this same ID */
        }
      }
      return deploymentView((await deps.deployments.findById(id))!)
    },
  }
}
export type DeploymentService = ReturnType<typeof createDeploymentService>
