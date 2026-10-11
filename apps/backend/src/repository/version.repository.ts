import type { VersionDao } from '../dao/version.interface.ts'
export const createVersionRepository = (dao: VersionDao) => ({
  applications: dao.applications,
  transition: dao.transition,
  finalize: dao.finalize,
  create: dao.create,
})
export type VersionRepository = ReturnType<typeof createVersionRepository>
