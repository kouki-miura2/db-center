import { LIMITS } from 'utils'
import { expect, test } from 'vite-plus/test'

import { compareRevisions, dueScopes, isScopeKey, type ScopeQuery } from './revision-check.ts'

const INTERVAL = LIMITS.revisionCheckMinutes * 60_000
const NOW = 10 * INTERVAL

const query = (queryKey: unknown[], revision: number, checkedAt = 0): ScopeQuery => ({
  queryKey,
  revision,
  checkedAt,
})

test('recognizes only the cacheable scope keys', () => {
  expect(isScopeKey(['products'])).toBe(true)
  expect(isScopeKey(['product', 'p1'])).toBe(true)
  expect(isScopeKey(['database', 'd1'])).toBe(true)
  expect(isScopeKey(['version', 'v1'])).toBe(true)
  expect(isScopeKey(['auditLogs', 'p1'])).toBe(false)
  expect(isScopeKey(['product'])).toBe(false)
  expect(isScopeKey(['toString', 'x'])).toBe(false)
})

test('checks only the scopes last checked the interval or more ago, in one request', () => {
  const { due, body } = dueScopes(
    [
      query(['products'], 1),
      query(['product', 'p1'], 2),
      query(['database', 'd1'], 3, NOW - INTERVAL + 1),
      query(['version', 'v1'], 4, NOW - INTERVAL),
      query(['auditLogs', 'p1'], 5),
    ],
    NOW,
  )

  expect(due.map((q) => q.queryKey)).toEqual([['products'], ['product', 'p1'], ['version', 'v1']])
  expect(body).toEqual({
    productList: true,
    productIds: ['p1'],
    databaseIds: [],
    versionIds: ['v1'],
  })
})

test('checks at most the scopes allowed in one request', () => {
  const many = Array.from({ length: LIMITS.revisionCheckScopes + 5 }, (_, i) =>
    query(['version', `v${i}`], 1),
  )

  expect(dueScopes(many, NOW).body.versionIds).toHaveLength(LIMITS.revisionCheckScopes)
})

test('fetches again the changed scopes and the ones no longer visible', () => {
  const checked = [
    query(['products'], 1),
    query(['product', 'p1'], 2),
    query(['product', 'p2'], 2),
    query(['version', 'v1'], 4),
  ]

  const { changed, current } = compareRevisions(checked, {
    productList: 1,
    products: { p1: 3 },
    databases: {},
    versions: { v1: 4 },
  })

  expect(changed.map((q) => q.queryKey)).toEqual([
    ['product', 'p1'],
    ['product', 'p2'],
  ])
  expect(current.map((q) => q.queryKey)).toEqual([['products'], ['version', 'v1']])
})
