import { deploymentDaoContract } from './deployment.contract.ts'
import { createDeploymentMemoryDao } from './deployment.memory.ts'
import { createMemoryDb, memoryTable } from './memory-db.ts'
import { memberKey } from './product.memory.ts'

deploymentDaoContract(async () => {
  const db = createMemoryDb()
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
    dao: createDeploymentMemoryDao(db),
    audits: async () => memoryTable(db, 'audit_logs').size,
    revision: async () => memoryTable<{ revision: number }>(db, 'databases').get('d1')!.revision,
    changeVersion: async () => {
      memoryTable<{ revision: number }>(db, 'versions').get('v1')!.revision++
    },
  }
})
