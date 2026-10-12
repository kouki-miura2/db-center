import { createDatabaseMemoryDao } from './database.memory.ts'
import { deploymentDaoContract } from './deployment.contract.ts'
import { createDeploymentMemoryDao } from './deployment.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { memberKey } from './product.memory.ts'
import { createUserMemoryDao } from './user.memory.ts'

deploymentDaoContract(async () => {
  const db = createMemoryDb()
  memoryTable(db, 'users').set('u1', { id: 'u1', name: 'user', deletedAt: null })
  memoryTable(db, 'users').set('u2', { id: 'u2', name: 'reader', deletedAt: null })
  memoryTable(db, 'products').set('p1', { id: 'p1', revision: 1, deletedAt: null })
  memoryTable(db, 'product_members').set(memberKey('p1', 'u1'), {
    productId: 'p1',
    userId: 'u1',
    role: 'owner',
  })
  memoryTable(db, 'databases').set('d1', {
    id: 'd1',
    productId: 'p1',
    revision: 1,
    deletedAt: null,
  })
  memoryTable(db, 'connections').set('c1', { id: 'c1', productId: 'p1', updatedAt: 1000 })
  memoryTable(db, 'versions').set('v1', {
    id: 'v1',
    databaseId: 'd1',
    status: 'provisional',
    revision: 1,
  })
  return {
    databaseScope: createDatabaseMemoryDao(db).findScope,
    removeExecutor: async () => {
      memoryTable(db, 'product_members').delete(memberKey('p1', 'u1'))
      memoryTable(db, 'product_members').set(memberKey('p1', 'u2'), {
        productId: 'p1',
        userId: 'u2',
        role: 'owner',
      })
    },
    withdrawExecutor: () =>
      createUserMemoryDao(db).withdraw({
        userId: 'u1',
        name: 'user',
        anonymizedName: '退会したユーザー',
        now: 5000,
      }),
    dao: createDeploymentMemoryDao(db),
    audits: async () => memoryTable(db, 'audit_logs').size,
    revision: async () => memoryTable<{ revision: number }>(db, 'databases').get('d1')!.revision,
    markDatabaseDeleted: async () => {
      memoryTable<{ deletedAt: number | null }>(db, 'databases').get('d1')!.deletedAt = 5000
    },
    changeVersion: async () => {
      memoryTable<{ revision: number }>(db, 'versions').get('v1')!.revision++
    },
  }
})
