import type { ConnectionRecord } from '../dao/connection.interface.ts'
import { AppError } from '../error.ts'
import type { ConnectionRepository } from '../repository/connection.repository.ts'
import type { DeploymentStorage } from '../repository/deployment-runtime.interface.ts'
import type { DeploymentRepository } from '../repository/deployment.repository.ts'
import type { ObjectRepository } from '../repository/object.repository.ts'
import { readPostgresCatalog } from '../repository/postgres-catalog.ts'
import {
  inspectPostgres,
  type PostgresAdapter,
  type PgSession,
} from '../repository/postgres.interface.ts'
import type { SecretBox } from '../repository/secret-box.interface.ts'
import { deploymentChecks } from './deployment-checks.ts'
import type { DeploymentPlan } from './deployment.service.ts'
import { hashText } from './drift.ts'

export const createDeploymentExecutor = (deps: {
  deployments: DeploymentRepository
  storage: DeploymentStorage
  connections: ConnectionRepository
  objects: ObjectRepository
  secrets: SecretBox
  postgres: PostgresAdapter
}) => ({
  execute: async (id: string) => {
    if (!(await deps.deployments.claim(id))) return { deploymentId: id, status: 'not_claimed' }
    const record = (await deps.deployments.findById(id))!
    let session: PgSession | undefined,
      inTransaction = false,
      committed = false,
      count = 0,
      locked = false
    let precheckReasons: string[] = []
    const groups: Record<string, { statements: number; rows: number; durationMs: number }> = {}
    let lastStep: {
      index: number
      objectKey: string | null
      phase: string
      kind: string
      status: 'running' | 'succeeded'
    } | null = null
    const log = (code?: string) =>
      JSON.stringify({
        groups,
        lastStep,
        committed,
        ...(precheckReasons.length ? { precheckReasons } : {}),
        ...(code ? { code, requiresInspection: true } : {}),
      })
    try {
      const encoded = await deps.storage.get(`deployments/${id}.json`)
      if (!encoded || (await hashText(encoded)) !== record.planHash)
        throw new AppError('invalid_state')
      const plan = JSON.parse(encoded) as DeploymentPlan
      if (
        plan.kind !== record.kind ||
        plan.target.versionId !== record.toVersionId ||
        plan.databaseId !== record.databaseId ||
        plan.productId !== record.productId
      )
        throw new AppError('invalid_state')
      if ((await deps.storage.get(`deployments/${id}.sql`)) !== plan.sql)
        throw new AppError('invalid_state')
      const frozen = JSON.parse(record.connectionSnapshot) as ConnectionRecord,
        current = await deps.connections.findCredentials(record.connectionId!)
      const target = await deps.objects.findContext(record.toVersionId)
      const source = record.fromVersionId
        ? await deps.objects.findContext(record.fromVersionId)
        : null
      if (
        !current ||
        current.productId !== record.productId ||
        current.updatedAt !== frozen.updatedAt ||
        !target ||
        target.version.revision !== record.targetRevision ||
        target.version.status === 'editing' ||
        (record.fromVersionId &&
          (!source ||
            source.version.status === 'editing' ||
            source.version.revision !== record.sourceRevision ||
            source.version.databaseId !== record.databaseId))
      )
        throw new AppError('stale_update')
      const password =
        frozen.passwordEncrypted === null
          ? null
          : await deps.secrets.decrypt(frozen.passwordEncrypted, 'connection-password', frozen.id)
      session = await deps.postgres.open(frozen.connectionString, password)
      locked =
        (await session.query('SELECT pg_try_advisory_lock(208833377,1) AS locked')).rows[0]
          ?.locked === true
      if (!locked) throw new AppError('invalid_state')
      const inspection = await inspectPostgres(session)
      const catalog = inspection.supported ? await readPostgresCatalog(session) : null
      const checks = deploymentChecks(plan, inspection, catalog)
      precheckReasons = checks.reasons
      if (checks.reasons.length) throw new AppError('invalid_state', { message: checks.reasons[0] })
      const execute = async (sql: string, phase: string, objectKey: string | null = null) => {
        const kind = sql.includes('"_dbcenter"."version"')
          ? 'version'
          : phase === 'constraint'
            ? 'constraint'
            : (sql
                .match(
                  /^(?:CREATE|ALTER|DROP|COMMENT ON)\s+(?:UNIQUE\s+)?(SCHEMA|SEQUENCE|TABLE|MATERIALIZED VIEW|VIEW|INDEX|COLUMN)\b/i,
                )?.[1]
                ?.toLowerCase()
                .replaceAll(' ', '_') ?? phase)
        lastStep = { index: count, objectKey, phase, kind, status: 'running' }
        // Persist intent before executing. Lost acknowledgements never permit a replay.
        await deps.deployments.progress(id, count, log())
        const start = Date.now(),
          result = await session!.query(sql)
        if (phase === 'begin') inTransaction = true
        if (phase === 'commit') {
          inTransaction = false
          committed = true
        }
        const group = (groups[kind === phase ? phase : `${phase}:${kind}`] ??= {
          statements: 0,
          rows: 0,
          durationMs: 0,
        })
        group.statements++
        group.rows += result.rowCount
        group.durationMs += Date.now() - start
        lastStep.status = 'succeeded'
        count++
        await deps.deployments.progress(id, count, log())
      }
      for (const step of plan.steps.filter((v) => v.beforeTransaction))
        await execute(step.sql, 'before', step.objectKey)
      const inside = plan.steps.filter((v) => v.transactional && !v.beforeTransaction)
      if (inside.length) {
        await execute('BEGIN;', 'begin')
        inTransaction = true
      }
      for (const step of inside)
        await execute(step.sql, step.phase ?? 'transaction', step.objectKey)
      if (inTransaction) {
        await execute('COMMIT;', 'commit')
        inTransaction = false
        committed = true
      }
      for (const step of plan.steps.filter((v) => !v.transactional && !v.beforeTransaction))
        await execute(step.sql, 'outside', step.objectKey)
      await deps.deployments.finish(id, 'succeeded', log(), Date.now())
      return { deploymentId: id, status: 'succeeded' }
    } catch (error) {
      if (inTransaction && session)
        try {
          await session.query('ROLLBACK;')
        } catch {
          /* Outcome remains uncertain. */
        }
      const code = error instanceof AppError ? error.code : 'execution_failed'
      await deps.deployments.finish(id, 'failed', log(code), Date.now())
      return { deploymentId: id, status: 'failed' }
    } finally {
      if (session) {
        if (locked)
          try {
            await session.query('SELECT pg_advisory_unlock(208833377,1)')
          } catch {
            /* Session close releases the lock. */
          }
        await session.close()
      }
    }
  },
})
