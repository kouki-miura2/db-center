import { userDaoContract } from 'backend/src/dao/user.contract.ts'
import { afterEach } from 'vite-plus/test'

import { createTestD1 } from './test-d1.ts'
import { createUserD1Dao } from './user.d1.ts'

let dispose: (() => Promise<void>) | undefined
afterEach(() => dispose?.())

userDaoContract(async () => {
  const testD1 = await createTestD1()
  dispose = testD1.dispose
  const { db } = testD1
  return {
    dao: createUserD1Dao(db),
    countSessions: async () =>
      (await db.prepare('SELECT count(*) AS n FROM sessions').first<{ n: number }>())?.n ?? 0,
  }
})
