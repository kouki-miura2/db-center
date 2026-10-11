import { createMemoryDb, memoryTable } from './memory-db.ts'
import { userDaoContract } from './user.contract.ts'
import { createUserMemoryDao } from './user.memory.ts'

userDaoContract(async () => {
  const db = createMemoryDb()
  return {
    dao: createUserMemoryDao(db),
    countSessions: async () => memoryTable(db, 'sessions').size,
  }
})
