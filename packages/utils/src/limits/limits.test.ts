import { expect, test } from 'vite-plus/test'

import { LIMITS } from './limits.ts'

// Mirrors the docs/spec.md "参照 > リミット値" table; update both together.
test('matches the spec table', () => {
  expect(LIMITS).toEqual({
    membersPerProduct: 10,
    productsPerUser: 20,
    invitationHours: 24,
    passcodeFailures: 5,
    passcodeFailureWindowHours: 1,
    deletedRetentionDays: 30,
    auditLogRetentionDays: 365,
    sessionDays: 30,
    revisionCheckMinutes: 5,
    userNameMaxLength: 30,
    productNameMaxLength: 50,
    connectionNameMaxLength: 30,
    connectionStringMaxLength: 500,
    databaseDescriptionMaxLength: 200,
    logicalNameMaxLength: 100,
    commentMaxLength: 500,
    expressionMaxLength: 1000,
    connectionsPerProduct: 10,
    databasesPerProduct: 20,
    objectsPerVersion: 1000,
    columnsPerTable: 200,
    versionDefinitionBytes: 10 * 1024 * 1024,
    revisionCheckScopes: 100,
    auditLogPageSize: 50,
    cleanupBatchSize: 500,
    postgresConnectTimeoutSeconds: 10,
    postgresStatementTimeoutSeconds: 60,
    deploymentWorkflowTimeoutMinutes: 60,
    deploymentReconcileMinutes: 10,
  })
})
