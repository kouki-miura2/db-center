import { createApp } from 'backend/src/app.ts'
import { createSampleDao } from 'backend/src/dao/sample.memory.ts'
import { createAuthGuard } from 'backend/src/repository/auth-guard.header.ts'
import { createSampleRepository } from 'backend/src/repository/sample.repository.ts'
import { createSampleService } from 'backend/src/service/sample.service.ts'

export default createApp({
  sampleService: createSampleService(createSampleRepository(createSampleDao())),
  auth: { guard: createAuthGuard(), enabled: false, excludePaths: [] },
})
