import { expect, test } from 'vite-plus/test'

import { createRevisionRepository } from './revision.repository.ts'

test('passes the request through and returns the revisions as they are', async () => {
  const revisions = { productList: 2, products: { p1: 3 }, databases: {}, versions: {} }
  const input = {
    userId: 'u1',
    productList: true,
    productIds: ['p1'],
    databaseIds: [],
    versionIds: [],
  }
  const asked: unknown[] = []
  const repository = createRevisionRepository({
    findRevisions: async (request) => {
      asked.push(request)
      return revisions
    },
  })

  expect(await repository.findRevisions(input)).toEqual(revisions)
  expect(asked).toEqual([input])
})
