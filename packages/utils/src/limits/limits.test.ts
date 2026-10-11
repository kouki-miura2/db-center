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
    connectionsPerProduct: 10,
    databasesPerProduct: 20,
    objectsPerVersion: 1000,
    columnsPerTable: 200,
  })
})
