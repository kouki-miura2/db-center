import type { PgInspection } from '../repository/postgres.interface.ts'
import type { DeploymentPlan } from './deployment.service.ts'
import { compareCatalogs, matchesAppliedDesign } from './drift.ts'

/** Used on preview/receipt and again under the physical database's execution lock. */
export const deploymentChecks = (
  plan: DeploymentPlan,
  inspection: PgInspection,
  catalog: Record<string, unknown> | null,
) => {
  const reasons: string[] = []
  if (!inspection.supported) reasons.push('unsupported_postgres')
  if (plan.kind === 'build') {
    if (
      !inspection.empty ||
      (catalog && Object.keys(catalog).some((key) => key !== 'schema:public'))
    )
      reasons.push('database_not_empty')
    return { reasons, drift: null, dataLoss: false }
  }
  if (
    !plan.source ||
    !matchesAppliedDesign(inspection.applied, { databaseId: plan.databaseId, ...plan.source })
  )
    reasons.push('applied_version_mismatch')
  const drift = compareCatalogs(inspection.applied?.catalog, catalog ?? {})
  if (!catalog || !drift.verifiable) reasons.push('drift_unverifiable')
  else if (drift.count) reasons.push('drift_detected')
  if (plan.dataLoss) reasons.push('data_loss')
  return { reasons, drift, dataLoss: plan.dataLoss === true }
}
