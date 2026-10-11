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
  deleteAll: async (keys) => {
    // R2 deletes at most 1,000 keys per call.
    for (let start = 0; start < keys.length; start += R2_DELETE_KEYS) {
      await bucket.delete(keys.slice(start, start + R2_DELETE_KEYS))
    }
  },
})

const R2_DELETE_KEYS = 1000
const FINISHED: InstanceStatus['status'][] = ['complete', 'errored', 'terminated']

export const createDeploymentWorkflow = (
  workflow: Workflow<{ deploymentId: string }>,
): DeploymentWorkflow => ({
  start: async (deploymentId) => {
    await workflow.create({ id: deploymentId, params: { deploymentId } })
  },
  status: async (deploymentId) => {
    let instance: WorkflowInstance
    try {
      instance = await workflow.get(deploymentId)
    } catch {
      return 'missing'
    }
    // Anything not plainly over (`unknown` included) counts as still active.
    const { status } = await instance.status()
    return FINISHED.includes(status) ? 'finished' : 'active'
  },
})
