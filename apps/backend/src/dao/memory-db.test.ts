import { expect, test } from 'vite-plus/test'

import { AppError } from '../error.ts'
import type { AuditLogRecord } from './audit-log.interface.ts'
import { appendAuditLog, assertCurrent, atomic, createMemoryDb, memoryTable } from './memory-db.ts'
import { nextUpdatedAt } from './write.ts'

interface Item {
  id: string
  name: string
  updatedAt: number
  revision: number
}

const entry = (id: string): AuditLogRecord => ({
  id,
  productId: 'p1',
  userId: 'u1',
  targetType: 'product',
  action: 'update',
  summary: 'P',
  createdAt: 0,
})

const setup = () => {
  const db = createMemoryDb()
  memoryTable<Item>(db, 'items').set('i1', { id: 'i1', name: 'A', updatedAt: 100, revision: 1 })
  return db
}

// The shape of every in-memory write: check, change, bump, log — inside one `atomic`.
const rename = (
  db: ReturnType<typeof createMemoryDb>,
  name: string,
  expected: number,
  now: number,
) =>
  atomic(db, () => {
    const row = assertCurrent(memoryTable<Item>(db, 'items').get('i1'), expected)
    row.name = name
    row.updatedAt = nextUpdatedAt(now, row.updatedAt)
    row.revision += 1
    appendAuditLog(db, entry(`a${now}`))
    return { ...row }
  })

test('applies the change, the revision and the audit log together', () => {
  const db = setup()

  expect(rename(db, 'B', 100, 200)).toEqual({ id: 'i1', name: 'B', updatedAt: 200, revision: 2 })
  expect(memoryTable(db, 'audit_logs').size).toBe(1)
})

test('changes nothing when the expected updated_at is stale', () => {
  const db = setup()

  expect(() => rename(db, 'B', 99, 200)).toThrow(AppError)
  expect(memoryTable<Item>(db, 'items').get('i1')).toEqual({
    id: 'i1',
    name: 'A',
    updatedAt: 100,
    revision: 1,
  })
  expect(memoryTable(db, 'audit_logs').size).toBe(0)
})

test('rolls back every table when a later step fails', () => {
  const db = setup()

  expect(() =>
    atomic(db, () => {
      appendAuditLog(db, entry('a1'))
      memoryTable<Item>(db, 'items').get('i1')!.name = 'B'
      throw new AppError('limit_exceeded')
    }),
  ).toThrow(expect.objectContaining({ code: 'limit_exceeded' }))
  expect(memoryTable<Item>(db, 'items').get('i1')?.name).toBe('A')
  expect(memoryTable(db, 'audit_logs').size).toBe(0)
})

test('lets only the first of two saves from the same snapshot win', () => {
  const db = setup()

  rename(db, 'B', 100, 100)
  expect(() => rename(db, 'C', 100, 100)).toThrow(expect.objectContaining({ code: 'stale_update' }))
  // Saved in the same millisecond as it was read, the row still got a newer updated_at.
  expect(memoryTable<Item>(db, 'items').get('i1')).toMatchObject({ name: 'B', updatedAt: 101 })
})
