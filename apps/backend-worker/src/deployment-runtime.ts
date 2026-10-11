import { AppError } from 'backend/src/error.ts'
import type {
  DeploymentStorage,
  DeploymentWorkflow,
} from 'backend/src/repository/deployment-runtime.interface.ts'

export const createDeploymentStorage = (bucket: R2Bucket): DeploymentStorage => ({
  putOnce: async (key, value) => {
    const result = await bucket.put(key, value, { onlyIf: { etagDoesNotMatch: '*' } })
    if (!result) throw new AppError('invalid_state')
  },
  get: async (key) => (await bucket.get(key))?.text() ?? null,
})
export const createDeploymentWorkflow = (
  workflow: Workflow<{ deploymentId: string }>,
): DeploymentWorkflow => ({
  start: async (deploymentId) => {
    await workflow.create({ id: deploymentId, params: { deploymentId } })
  },
})
