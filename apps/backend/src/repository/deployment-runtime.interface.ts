export interface DeploymentStorage {
  putOnce: (key: string, value: string) => Promise<void>
  get: (key: string) => Promise<string | null>
}
export interface DeploymentWorkflow {
  start: (deploymentId: string) => Promise<void>
}
