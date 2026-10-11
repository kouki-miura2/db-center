/** Revisions of the scopes a user may see, keyed by ID. A scope they may not see is left out. */
export interface RevisionsRecord {
  /** The user's product list revision; null unless asked for. */
  productList: number | null
  products: Record<string, number>
  databases: Record<string, number>
  versions: Record<string, number>
}

export interface RevisionDao {
  /**
   * The revisions of the given scopes, read together. A product, database or version is left out
   * unless it and every parent isn't deleted and `userId` is a member of its product, so nothing
   * about scopes outside their products is revealed.
   */
  findRevisions: (input: {
    userId: string
    productList: boolean
    productIds: string[]
    databaseIds: string[]
    versionIds: string[]
  }) => Promise<RevisionsRecord>
}
