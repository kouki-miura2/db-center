import type { VersionDao } from '../dao/version.interface.ts'
export const createVersionRepository = (dao: VersionDao) => ({
  applications: dao.applications,
  transition: dao.transition,
})
export type VersionRepository = ReturnType<typeof createVersionRepository>
