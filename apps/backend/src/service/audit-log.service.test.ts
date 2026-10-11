import { LIMITS } from 'utils'
import { expect, test, vi } from 'vite-plus/test'

import type { AuditLogEntryRecord } from '../dao/audit-log.dao.interface.ts'
import type { AuditLogRepository } from '../repository/audit-log.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import { createAuditLogService, parseCursor, toCursor } from './audit-log.service.ts'

const products = (member: boolean) =>
  ({
    findMembership: async () =>
      member
        ? {
            product: {
              id: 'p1',
              name: 'shop',
              target: 'sqlite3',
              createdAt: 1,
              updatedAt: 1,
              revision: 1,
            },
            role: 'member',
            joinedAt: 1,
          }
        : null,
  }) as unknown as ProductRepository

const entry = (index: number): AuditLogEntryRecord => ({
  id: `a${index}`,
  productId: 'p1',
  userId: 'u1',
  targetType: 'product',
  action: 'update',
  summary: 'shop',
  createdAt: 10_000 - index,
  userName: 'はなこ',
})

const rows = (count: number) => Array.from({ length: count }, (_, i) => entry(i))

test('round-trips a cursor and rejects a malformed one', () => {
  expect(parseCursor(toCursor({ createdAt: 123, id: 'ab-12' }))).toEqual({
    createdAt: 123,
    id: 'ab-12',
  })
  expect(parseCursor(undefined)).toBeUndefined()
  expect(() => parseCursor('x; DROP')).toThrow(expect.objectContaining({ code: 'invalid_input' }))
})

test('returns a page and where the next, older one starts', async () => {
  const list = vi.fn<AuditLogRepository['list']>(async () => rows(LIMITS.auditLogPageSize + 1))
  const service = createAuditLogService({ products: products(true), auditLogs: { list } })

  const result = await service.list({ userId: 'u1', productId: 'p1', before: '9999_a0' })

  expect(result.entries).toHaveLength(LIMITS.auditLogPageSize)
  expect(result.entries[0]).toMatchObject({ id: 'a0', userName: 'はなこ', cursor: '10000_a0' })
  expect(result.nextBefore).toBe(result.entries.at(-1)?.cursor)
  expect(result.truncated).toBe(false)
  expect(list.mock.calls[0]?.[0]).toMatchObject({
    before: { createdAt: 9999, id: 'a0' },
    limit: LIMITS.auditLogPageSize + 1,
  })
})

test('says there is no older page at the end', async () => {
  const service = createAuditLogService({
    products: products(true),
    auditLogs: { list: async () => rows(3) },
  })

  expect((await service.list({ userId: 'u1', productId: 'p1' })).nextBefore).toBeNull()
})

test('flags more new entries than a page, so the client starts over', async () => {
  const service = createAuditLogService({
    products: products(true),
    auditLogs: { list: async () => rows(LIMITS.auditLogPageSize + 1) },
  })

  expect((await service.list({ userId: 'u1', productId: 'p1', after: '1_a9' })).truncated).toBe(
    true,
  )
})

test('hides the log from a non-member', async () => {
  const service = createAuditLogService({
    products: products(false),
    auditLogs: { list: async () => rows(1) },
  })

  await expect(service.list({ userId: 'u9', productId: 'p1' })).rejects.toMatchObject({
    code: 'not_found',
  })
})
