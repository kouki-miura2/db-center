import type { RevisionRepository, Revisions } from '../repository/revision.repository.ts'

export interface RevisionService {
  /**
   * The current revisions of several cached scopes at once ("参照 > データの取得とキャッシュ >
   * リビジョンを確認するタイミング"). A scope missing from the answer is one the user can't see
   * (anymore): deleted, left, or never theirs.
   */
  check: (input: {
    userId: string
    productList: boolean
    productIds: string[]
    databaseIds: string[]
    versionIds: string[]
  }) => Promise<Revisions>
}

export const createRevisionService = (deps: {
  revisions: RevisionRepository
}): RevisionService => ({
  check: ({ userId, productList, productIds, databaseIds, versionIds }) =>
    deps.revisions.findRevisions({
      userId,
      productList,
      productIds: [...new Set(productIds)],
      databaseIds: [...new Set(databaseIds)],
      versionIds: [...new Set(versionIds)],
    }),
})
