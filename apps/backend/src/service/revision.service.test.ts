import { expect, test, vi } from 'vite-plus/test'

import type { RevisionRepository } from '../repository/revision.repository.ts'
import { createRevisionService } from './revision.service.ts'

test('asks for each scope once, as the user, and answers what the repository found', async () => {
  const revisions = { productList: null, products: { p1: 3 }, databases: {}, versions: {} }
  const findRevisions = vi.fn<RevisionRepository['findRevisions']>(async () => revisions)
  const service = createRevisionService({ revisions: { findRevisions } })

  const result = await service.check({
    userId: 'u1',
    productList: false,
    productIds: ['p1', 'p2', 'p1'],
    databaseIds: ['d1', 'd1'],
    versionIds: [],
  })

  expect(result).toEqual(revisions)
  expect(findRevisions).toHaveBeenCalledWith({
    userId: 'u1',
    productList: false,
    productIds: ['p1', 'p2'],
    databaseIds: ['d1'],
    versionIds: [],
  })
})
