import { LIMITS } from 'utils'

// Checking only the revisions of the scopes on screen, together in one request, when the app
// comes back to the front or online ("参照 > データの取得とキャッシュ > リビジョンを確認するタイミング").

/** A cached scope query: its key (`scopeKeys`), when it was last checked, and its revision. */
export interface ScopeQuery {
  queryKey: readonly unknown[]
  checkedAt: number
  revision: number | undefined
}

/** The answer of `POST /api/revisions/check`: a scope left out is one the user can't see. */
export interface Revisions {
  productList: number | null
  products: Record<string, number>
  databases: Record<string, number>
  versions: Record<string, number>
}

const KINDS = { product: 'productIds', database: 'databaseIds', version: 'versionIds' } as const

const isScopeKind = (kind: unknown): kind is keyof typeof KINDS =>
  typeof kind === 'string' && Object.hasOwn(KINDS, kind)

/** Whether the query is a cacheable scope (see `scopeKeys`). */
export const isScopeKey = (queryKey: readonly unknown[]): boolean =>
  (queryKey.length === 1 && queryKey[0] === 'products') ||
  (queryKey.length === 2 && isScopeKind(queryKey[0]) && typeof queryKey[1] === 'string')

/**
 * The scopes due for a check (last checked `LIMITS.revisionCheckMinutes` or more ago), at most
 * `LIMITS.revisionCheckScopes` of them, and the request body that checks them.
 */
export const dueScopes = (queries: ScopeQuery[], now: number) => {
  const due = queries
    .filter(
      (q) => isScopeKey(q.queryKey) && now - q.checkedAt >= LIMITS.revisionCheckMinutes * 60_000,
    )
    .slice(0, LIMITS.revisionCheckScopes)
  const body = {
    productList: false,
    productIds: [] as string[],
    databaseIds: [] as string[],
    versionIds: [] as string[],
  }
  for (const {
    queryKey: [kind, id],
  } of due) {
    if (kind === 'products') body.productList = true
    else if (isScopeKind(kind)) body[KINDS[kind]].push(id as string)
  }
  return { due, body }
}

const serverRevision = ([kind, id]: readonly unknown[], revisions: Revisions) =>
  kind === 'products'
    ? revisions.productList
    : ({ product: revisions.products, database: revisions.databases, version: revisions.versions }[
        kind as keyof typeof KINDS
      ][id as string] ?? null)

/**
 * Splits the checked scopes into the ones to fetch again (changed, or no longer visible, which the
 * fetch then reports) and the ones still current.
 */
export const compareRevisions = (checked: ScopeQuery[], revisions: Revisions) => ({
  changed: checked.filter((q) => serverRevision(q.queryKey, revisions) !== q.revision),
  current: checked.filter((q) => serverRevision(q.queryKey, revisions) === q.revision),
})
