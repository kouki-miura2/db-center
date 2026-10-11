import type { DeploymentDao, DeploymentRecord } from 'backend/src/dao/deployment.interface.ts'
import type { Role } from 'backend/src/dao/product.interface.ts'
import { AppError } from 'backend/src/error.ts'

import { guard, insertAuditLog, runBatch, staleGuard } from './batch.ts'
import { actorHasRole, bumpProductRevision } from './product.d1.ts'

type Row = { [K in string]: unknown }
export const toDeploymentRecord = (r: Row): DeploymentRecord => ({
  id: r.id as string,
  productId: r.product_id as string,
  databaseId: r.database_id as string,
  connectionId: r.connection_id as string | null,
  connectionName: r.connection_name as string,
  kind: r.kind as DeploymentRecord['kind'],
  fromVersionId: r.from_version_id as string | null,
  toVersionId: r.to_version_id as string,
  status: r.status as DeploymentRecord['status'],
  phase: r.phase as DeploymentRecord['phase'],
  executedBy: r.executed_by as string,
  startedAt: r.started_at as number,
  finishedAt: r.finished_at as number | null,
  log: r.log as string | null,
  idempotencyKey: r.idempotency_key as string,
  requestHash: r.request_hash as string,
  planHash: r.plan_hash as string,
  connectionSnapshot: r.connection_snapshot as string,
  targetRevision: r.target_revision as number,
  sourceRevision: r.source_revision as number | null,
  executedCount: r.executed_count as number,
  revision: r.revision as number,
})
export const createDeploymentD1Dao = (db: D1Database): DeploymentDao => {
  const find = async (sql: string, ...params: unknown[]) => {
    const r = await db
      .prepare(sql)
      .bind(...params)
      .first<Row>()
    return r ? toDeploymentRecord(r) : null
  }
  // Ends a running deployment (and `condition`, extra WHERE terms with their params, holds): its
  // status, the database and product revisions and the audit log, in one batch.
  const close = (
    r: DeploymentRecord,
    status: 'succeeded' | 'failed',
    log: string,
    now: number,
    condition: string,
    ...params: unknown[]
  ) =>
    runBatch(db, [
      // The database's revision first, so the row can record it.
      db.prepare('UPDATE databases SET revision=revision+1 WHERE id=?').bind(r.databaseId),
      db
        .prepare(
          `UPDATE deployments SET status=?,phase='finished',log=?,finished_at=?,revision=(SELECT revision FROM databases WHERE id=deployments.database_id) WHERE id=? AND status='running'${condition}`,
        )
        .bind(status, log, now, r.id, ...params),
      staleGuard(db),
      bumpProductRevision(db, r.productId),
      insertAuditLog(db, {
        id: crypto.randomUUID(),
        productId: r.productId,
        userId: r.executedBy,
        targetType: 'deployment',
        action: status,
        summary: r.connectionName,
        createdAt: now,
      }),
    ])
  const transition = async (id: string, from: string, to: string) => {
    const r = await db
      .prepare("UPDATE deployments SET phase=? WHERE id=? AND status='running' AND phase=?")
      .bind(to, id, from)
      .run()
    return r.meta.changes === 1
  }
  return {
    findById: (id) => find('SELECT * FROM deployments WHERE id=?', id),
    findByKey: (id, key) =>
      find('SELECT * FROM deployments WHERE connection_id=? AND idempotency_key=?', id, key),
    listByVersion: async (versionId) =>
      (
        await db
          .prepare(
            'SELECT * FROM deployments WHERE to_version_id=? ORDER BY started_at DESC,id DESC',
          )
          .bind(versionId)
          .all<Row>()
      ).results.map(toDeploymentRecord),
    // One query: the deployment, its live parents and the user's membership by primary key.
    findForMember: async (id, userId) => {
      const row = await db
        .prepare(
          `SELECT x.*, m.role AS member_role FROM deployments x
          JOIN versions v ON v.id = x.to_version_id
          JOIN databases d ON d.id = v.database_id AND d.deleted_at IS NULL
          JOIN products p ON p.id = d.product_id AND p.id = x.product_id AND p.deleted_at IS NULL
          JOIN product_members m ON m.product_id = p.id AND m.user_id = ?
          WHERE x.id = ?`,
        )
        .bind(userId, id)
        .first<Row>()
      return row ? { record: toDeploymentRecord(row), role: row.member_role as Role } : null
    },
    accept: async ({ record: r, userId, allowedRoles, connectionUpdatedAt, audit }) => {
      await runBatch(db, [
        actorHasRole(db, r.productId, userId, allowedRoles),
        guard(
          db,
          'stale_update',
          'NOT EXISTS(SELECT 1 FROM connections WHERE id=? AND product_id=? AND updated_at=?)',
          r.connectionId,
          r.productId,
          connectionUpdatedAt,
        ),
        guard(
          db,
          'stale_update',
          "NOT EXISTS(SELECT 1 FROM versions v JOIN databases d ON d.id=v.database_id WHERE v.id=? AND v.database_id=? AND d.product_id=? AND d.deleted_at IS NULL AND v.status<>'editing' AND v.revision=?)",
          r.toVersionId,
          r.databaseId,
          r.productId,
          r.targetRevision,
        ),
        ...(r.fromVersionId
          ? [
              guard(
                db,
                'stale_update',
                "NOT EXISTS(SELECT 1 FROM versions WHERE id=? AND database_id=? AND status<>'editing' AND revision=?)",
                r.fromVersionId,
                r.databaseId,
                r.sourceRevision,
              ),
            ]
          : []),
        // The database's revision first, so the new row can record it.
        db.prepare('UPDATE databases SET revision=revision+1 WHERE id=?').bind(r.databaseId),
        db
          .prepare(
            'INSERT INTO deployments(id,product_id,database_id,connection_id,connection_name,kind,from_version_id,to_version_id,status,phase,executed_by,started_at,finished_at,log,idempotency_key,request_hash,plan_hash,connection_snapshot,target_revision,source_revision,executed_count,revision) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,(SELECT revision FROM databases WHERE id=?))',
          )
          .bind(
            r.id,
            r.productId,
            r.databaseId,
            r.connectionId,
            r.connectionName,
            r.kind,
            r.fromVersionId,
            r.toVersionId,
            r.status,
            r.phase,
            r.executedBy,
            r.startedAt,
            r.finishedAt,
            r.log,
            r.idempotencyKey,
            r.requestHash,
            r.planHash,
            r.connectionSnapshot,
            r.targetRevision,
            r.sourceRevision,
            r.executedCount,
            r.databaseId,
          ),
        bumpProductRevision(db, r.productId),
        insertAuditLog(db, audit),
      ])
    },
    queue: (id) => transition(id, 'preparing', 'queued'),
    claim: (id) => transition(id, 'queued', 'executing'),
    progress: async (id, count, log) => {
      await db
        .prepare(
          "UPDATE deployments SET log=?,executed_count=? WHERE id=? AND phase='executing' AND status='running' AND executed_count<=?",
        )
        .bind(log, count, id, count)
        .run()
    },
    finish: async (id, status, log, now) => {
      const r = await find('SELECT * FROM deployments WHERE id=?', id)
      if (!r || r.status !== 'running') return
      try {
        await close(r, status, log, now, '')
      } catch (error) {
        if ((await find('SELECT * FROM deployments WHERE id=?', id))?.status === 'running')
          throw error
      }
    },
    listRunning: async (startedBefore) =>
      (
        await db
          .prepare(
            "SELECT * FROM deployments WHERE status='running' AND started_at<=? ORDER BY started_at,id",
          )
          .bind(startedBefore)
          .all<Row>()
      ).results.map(toDeploymentRecord),
    abandon: async ({ id, phase, executedCount, log, now }) => {
      const r = await find('SELECT * FROM deployments WHERE id=?', id)
      if (!r || r.status !== 'running') return false
      try {
        await close(
          r,
          'failed',
          log,
          now,
          ' AND phase=? AND executed_count=?',
          phase,
          executedCount,
        )
        return true
      } catch (error) {
        if (error instanceof AppError && error.code === 'stale_update') return false
        throw error
      }
    },
  }
}
