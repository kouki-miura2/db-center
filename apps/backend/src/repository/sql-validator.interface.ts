import type { Target } from 'utils'

import type { DesignObject } from './object.repository.ts'
export interface ViewAnalysis {
  columns: string[]
  dependencies: string[]
}
export interface SqlValidator {
  validateView: (
    target: Target,
    sql: string,
    objects: DesignObject[],
    schemaKey: string | null,
  ) => Promise<ViewAnalysis>
  validateExpression: (target: Target, expression: string, columns: string[]) => Promise<void>
  validateDataType: (target: Target, dataType: string) => Promise<void>
}
