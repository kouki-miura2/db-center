import { createConnectionRepository } from 'backend/src/repository/connection.repository.ts'
import { createDeploymentRepository } from 'backend/src/repository/deployment.repository.ts'
import { createObjectRepository } from 'backend/src/repository/object.repository.ts'
import { createAesGcmSecretBox } from 'backend/src/repository/secret-box.aes-gcm.ts'
import { createDeploymentExecutor } from 'backend/src/service/deployment-executor.service.ts'
import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers'
import { LIMITS } from 'utils'

import { createConnectionD1Dao } from './dao/connection.d1.ts'
import { createDeploymentD1Dao } from './dao/deployment.d1.ts'
import { createObjectD1Dao } from './dao/object.d1.ts'
import { createDeploymentStorage } from './deployment-runtime.ts'
import { createPostgresAdapter } from './postgres.ts'
import type { WorkerEnv } from './worker.ts'

export class DeploymentWorkflowEntrypoint extends WorkflowEntrypoint<
  WorkerEnv,
  { deploymentId: string }
> {
  run = async (event: WorkflowEvent<{ deploymentId: string }>, step: WorkflowStep) => {
    if (!this.env.DEPLOYMENT_SQL) throw new Error('deployment_storage_not_configured')
    return step.do(
      'execute frozen deployment',
      {
        retries: { limit: 0, delay: '1 second', backoff: 'constant' },
        timeout: `${LIMITS.deploymentWorkflowTimeoutMinutes} minutes`,
      },
      async () =>
        createDeploymentExecutor({
          deployments: createDeploymentRepository(createDeploymentD1Dao(this.env.DB)),
          storage: createDeploymentStorage(this.env.DEPLOYMENT_SQL!),
          connections: createConnectionRepository(createConnectionD1Dao(this.env.DB)),
          objects: createObjectRepository(createObjectD1Dao(this.env.DB)),
          secrets: createAesGcmSecretBox(this.env.ENCRYPTION_KEY || undefined),
          postgres: createPostgresAdapter(),
        }).execute(event.payload.deploymentId),
    )
  }
}
