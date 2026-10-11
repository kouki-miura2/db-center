import { databases, versions } from './database.memory.ts'
import { type MemoryDb, memoryTable } from './memory-db.ts'
import type { ProductRecord } from './product.interface.ts'
import { memberKey, type MemberRow } from './product.memory.ts'
import type { RevisionDao } from './revision.interface.ts'
import type { UserRecord } from './user.interface.ts'

/** In-memory `RevisionDao` over the shared `MemoryDb`. */
export const createRevisionMemoryDao = (db: MemoryDb): RevisionDao => ({
  findRevisions: async ({ userId, productList, productIds, databaseIds, versionIds }) => {
    // The product's revision, if it isn't deleted and the user is a member.
    const visibleProduct = (productId: string) => {
      const product = memoryTable<ProductRecord>(db, 'products').get(productId)
      const member = memoryTable<MemberRow>(db, 'product_members').get(memberKey(productId, userId))
      return product && product.deletedAt === null && member ? product : undefined
    }
    const visibleDatabase = (databaseId: string) => {
      const database = databases(db).get(databaseId)
      return database && database.deletedAt === null && visibleProduct(database.productId)
        ? database
        : undefined
    }
    const collect = <T extends { revision: number }>(
      ids: string[],
      find: (id: string) => T | undefined,
    ) =>
      Object.fromEntries(
        ids.flatMap((id) => {
          const row = find(id)
          return row ? [[id, row.revision]] : []
        }),
      )
    return {
      productList: productList
        ? (memoryTable<UserRecord>(db, 'users').get(userId)?.productsRevision ?? null)
        : null,
      products: collect(productIds, visibleProduct),
      databases: collect(databaseIds, visibleDatabase),
      versions: collect(versionIds, (versionId) => {
        const version = versions(db).get(versionId)
        return version && visibleDatabase(version.databaseId) ? version : undefined
      }),
    }
  },
})
