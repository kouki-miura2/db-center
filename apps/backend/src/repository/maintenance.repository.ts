import type { MaintenanceDao } from '../dao/maintenance.interface.ts'

export type MaintenanceRepository = MaintenanceDao

/** Cleanup works on counts and cutoffs only: nothing to map. */
export const createMaintenanceRepository = (dao: MaintenanceDao): MaintenanceRepository => ({
  ...dao,
})
