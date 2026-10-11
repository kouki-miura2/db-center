import type { DeploymentDao, DeploymentRecord } from '../dao/deployment.interface.ts'

export const deploymentView = (r: DeploymentRecord) => ({
  id: r.id,
  connectionId: r.connectionId,
  connectionName: r.connectionName,
  connectionDeleted: r.connectionId === null,
  kind: r.kind,
  fromVersionId: r.fromVersionId,
  toVersionId: r.toVersionId,
  status: r.status,
  phase: r.phase,
  executedBy: r.executedBy,
  startedAt: r.startedAt,
  finishedAt: r.finishedAt,
  executedCount: r.executedCount,
  log: r.log === null ? null : (JSON.parse(r.log) as unknown),
})
export const createDeploymentRepository = (dao: DeploymentDao) => ({ ...dao })
export type DeploymentRepository = ReturnType<typeof createDeploymentRepository>
