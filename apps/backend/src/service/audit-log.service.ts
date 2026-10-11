import { LIMITS } from 'utils'

import type { AuditLogCursor, AuditLogEntryRecord } from '../dao/audit-log.dao.interface.ts'
import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import { AppError } from '../error.ts'
import type { AuditLogRepository } from '../repository/audit-log.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import { assertAllowed } from './permission.ts'
import { requireMembership } from './product.service.ts'

export interface AuditLogEntryView {
  id: string
  createdAt: number
  /** The actor; their current name (退会したユーザー once withdrawn). */
  userId: string
  userName: string
  targetType: AuditLogRecord['targetType']
  action: string
  /** The target's name when it happened. */
  summary: string
  /** Where this entry is, for `before` / `after`. */
  cursor: string
}

export interface AuditLogService {
  /**
   * A product's audit log, newest first ("各論 > 履歴"): the newest page, the page older than
   * `before`, or every entry newer than `after` (the ones added since the client last looked).
   */
  list: (input: { userId: string; productId: string; before?: string; after?: string }) => Promise<{
    entries: AuditLogEntryView[]
    /** `before` for the next, older page; null when there's no more. */
    nextBefore: string | null
    /** With `after`: more new entries than a page, so the client should start over from the top. */
    truncated: boolean
  }>
}

// "<createdAt>_<id>": entries are ordered by both, so entries written in the same millisecond keep
// a stable order and paging neither skips nor repeats one.
export const toCursor = ({ createdAt, id }: AuditLogCursor): string => `${createdAt}_${id}`

export const parseCursor = (cursor: string | undefined): AuditLogCursor | undefined => {
  if (cursor === undefined) return undefined
  const match = /^(\d{1,15})_([0-9a-f-]{1,64})$/.exec(cursor)
  if (!match)
    throw new AppError('invalid_input', { fields: { cursor: '位置の指定が正しくありません' } })
  return { createdAt: Number(match[1]), id: match[2] as string }
}

const toView = (entry: AuditLogEntryRecord): AuditLogEntryView => ({
  id: entry.id,
  createdAt: entry.createdAt,
  userId: entry.userId,
  userName: entry.userName,
  targetType: entry.targetType,
  action: entry.action,
  summary: entry.summary,
  cursor: toCursor(entry),
})

export const createAuditLogService = (deps: {
  products: ProductRepository
  auditLogs: AuditLogRepository
}): AuditLogService => ({
  list: async ({ userId, productId, before, after }) => {
    const { role } = await requireMembership(deps.products, productId, userId)
    assertAllowed(role, 'viewAuditLog')
    const pageSize = LIMITS.auditLogPageSize
    // One more than a page tells whether there is more.
    const rows = await deps.auditLogs.list({
      productId,
      before: parseCursor(before),
      after: parseCursor(after),
      limit: pageSize + 1,
    })
    const page = rows.slice(0, pageSize).map(toView)
    const more = rows.length > pageSize
    return {
      entries: page,
      nextBefore: more ? (page.at(-1)?.cursor ?? null) : null,
      truncated: after !== undefined && more,
    }
  },
})
