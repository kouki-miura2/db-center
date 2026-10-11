export interface DeploymentStorage {
  putOnce: (key: string, value: string) => Promise<void>
  get: (key: string) => Promise<string | null>
  /** Deletes the objects; keys that don't exist are skipped. Throws if any can't be deleted. */
  deleteAll: (keys: string[]) => Promise<void>
}

/** The objects a deployment stores: its SQL and its frozen plan. */
export const deploymentStorageKeys = (deploymentId: string) => [
  `deployments/${deploymentId}.sql`,
  `deployments/${deploymentId}.json`,
]
export interface DeploymentWorkflow {
  start: (deploymentId: string) => Promise<void>
  /**
   * Where the deployment's Workflow instance is: still `active` (queued, running, paused or not
   * known yet), `finished` (complete, errored or terminated) or `missing` (never created, or it
   * couldn't be looked up).
   */
  status: (deploymentId: string) => Promise<'active' | 'finished' | 'missing'>
}
