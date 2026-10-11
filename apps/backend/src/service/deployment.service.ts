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
import { generatePostgresDdl, postgresVersionTable } from './ddl-postgres.ts'
import {
  ddlOptionsSchema,
  normalizedDesign,
  sqlLiteral,
  scriptResult,
  type SqlStep,
} from './ddl.ts'
import { deploymentChecks } from './deployment-checks.ts'
import { canonical, diffDesigns } from './design-diff.ts'
import { designHash, hashText, matchesAppliedDesign } from './drift.ts'
import type { InspectionService } from './inspection.service.ts'
import { generatePostgresMigration } from './migration-postgres.ts'
import { migrationOptionsSchema } from './migration.ts'
import { allowedRoles, assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export const deploymentPreviewSchema = z.strictObject({
  kind: z.enum(['build', 'migration']),
  toVersionId: z.uuid(),
  fromVersionId: z.uuid().optional(),
  expectedRevision: z.number().int().nonnegative(),
  migrationOptions: migrationOptionsSchema.omit({ includeDrops: true }).optional(),
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
  dataLoss?: boolean
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
    if (input.kind === 'build' && (input.fromVersionId || input.migrationOptions))
      throw new AppError('invalid_input')
    const objects = await normalizedDesign(scope.context, scope.objects, deps.sql)
    let generated = await generatePostgresDdl(
      scope.context,
      objects,
      deps.sql,
      ddlOptionsSchema.parse({ versionTable: true }),
    )
    let source: DeploymentPlan['source'] = null,
      dataLoss = false
    if (input.kind === 'migration') {
      if (!input.fromVersionId || input.fromVersionId === input.toVersionId)
        throw new AppError('invalid_input')
      const before = await deps.objects.findScope(input.fromVersionId)
      if (!before || before.context.version.databaseId !== scope.context.version.databaseId)
        throw new AppError('not_found')
      if (
        before.context.version.status === 'editing' ||
        before.context.version.number >= scope.context.version.number
      )
        throw new AppError('invalid_state')
      const previous = await normalizedDesign(before.context, before.objects, deps.sql)
      source = {
        versionId: input.fromVersionId,
        revision: before.context.version.revision,
        designHash: await designHash(previous),
      }
      dataLoss = diffDesigns(previous, objects, 'postgresql18').impact.dataLoss
      const migration = await generatePostgresMigration(
        scope.context,
        previous,
        objects,
        deps.sql,
        migrationOptionsSchema.parse({ ...input.migrationOptions, includeDrops: true }),
      )
      if (!migration.complete) throw new AppError('invalid_state')
      const steps = migration.steps.filter(
        (v) => !(v.objectKey === null && v.sql.includes('"_dbcenter"."version"')),
      )
      // Always advance a successful no-op version, and never advance before outside DDL.
      steps.push({
        objectKey: null,
        sql: (await postgresVersionTable(scope.context, objects))[2]!,
        transactional: !steps.some(
          (v) => !v.transactional && !v.beforeTransaction && !v.sql.startsWith('RESET '),
        ),
      })
      generated = scriptResult(scope.context, steps, true, migration.warnings)
    }
    const plan: DeploymentPlan = {
      kind: input.kind,
      databaseId: scope.context.version.databaseId,
      productId: connection.productId,
      target: {
        versionId: input.toVersionId,
        revision: input.expectedRevision,
        designHash: await designHash(objects),
      },
      source,
      dataLoss,
      steps: generated.steps,
      sql: generated.sql,
    }
    const inspection = await deps.inspection.inspect({
      userId: input.userId,
      connectionId: input.connectionId,
    })
    const checks = deploymentChecks(plan, inspection, inspection.catalog ?? null)
    const reasons = [
      ...(!deps.storage || !deps.workflow ? ['not_configured'] : []),
      ...checks.reasons,
    ]
    return { plan, inspection, reasons, checks }
  }
  return {
    script: async ({ userId, deploymentId }: { userId: string; deploymentId: string }) => {
      const record = await deps.deployments.findById(deploymentId)
      if (!record || !(await deps.objects.findContext(record.toVersionId)))
        throw new AppError('not_found')
      const member = await requireMembership(deps.products, record.productId, userId)
      assertAllowed(member.role, 'exportScripts')
      const sql = await deps.storage?.get(`deployments/${record.id}.sql`)
      if (sql === undefined)
        throw new AppError('invalid_state', { message: '実行SQLの保存先が設定されていません' })
      if (sql === null) throw new AppError('not_found')
      return { deploymentId: record.id, sql, fileName: `deployment_${record.id}.sql` }
    },
    finalizePreview: async ({ userId, versionId }: { userId: string; versionId: string }) => {
      const scope = await deps.objects.findScope(versionId)
      if (!scope) throw new AppError('not_found')
      const member = await requireMembership(deps.products, scope.context.productId, userId)
      assertAllowed(member.role, 'finalizeVersion')
      if (scope.context.version.status !== 'provisional') throw new AppError('invalid_state')
      const product = await deps.products.findScope(scope.context.productId)
      if (!product) throw new AppError('not_found')
      const hash = await designHash(await normalizedDesign(scope.context, scope.objects, deps.sql))
      const connections = []
      for (const connection of product.connections) {
        try {
          const inspection = await deps.inspection.inspect({ userId, connectionId: connection.id })
          const matches = matchesAppliedDesign(inspection.applied, {
            databaseId: scope.context.version.databaseId,
            versionId,
            revision: scope.context.version.revision,
            designHash: hash,
          })
          connections.push({
            id: connection.id,
            name: connection.name,
            status: !inspection.supported
              ? 'unsupported'
              : matches
                ? 'applied'
                : inspection.applied
                  ? 'different'
                  : 'unapplied',
            applied: inspection.applied
              ? {
                  versionId: inspection.applied.versionId,
                  versionNumber: inspection.applied.versionNumber,
                  revision: inspection.applied.revision,
                }
              : null,
          })
        } catch {
          connections.push({
            id: connection.id,
            name: connection.name,
            status: 'unknown',
            applied: null,
          })
        }
      }
      const history = (await deps.deployments.list(scope.context.version.databaseId))
        .filter((v) => v.toVersionId === versionId)
        .map(deploymentView)
      return { version: scope.context.version, connections, history }
    },
    get: async ({ userId, deploymentId }: { userId: string; deploymentId: string }) => {
      const record = await deps.deployments.findById(deploymentId)
      if (!record || !(await deps.objects.findContext(record.toVersionId)))
        throw new AppError('not_found')
      await requireMembership(deps.products, record.productId, userId)
      return deploymentView(record)
    },
    preview: async (input: DeploymentInput) => {
      const connection = await authorize(input.userId, input.connectionId)
      const { plan, inspection, reasons, checks } = await prepare(input, connection)
      return {
        canExecute: reasons.length === 0,
        reasons,
        inspection,
        sql: plan.sql,
        steps: plan.steps.map(({ sql: _sql, ...step }) => step),
        target: plan.target,
        source: plan.source,
        drift: checks.drift,
        dataLoss: checks.dataLoss,
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
          migrationOptions:
            input.kind === 'migration'
              ? migrationOptionsSchema.parse({ ...input.migrationOptions, includeDrops: true })
              : null,
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
