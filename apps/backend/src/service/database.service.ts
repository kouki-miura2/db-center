import { LIMITS, type Target } from 'utils'

import type { AuditLogRecord } from '../dao/audit-log.interface.ts'
import type { InitialSchema, VersionStatus } from '../dao/database.interface.ts'
import { AppError } from '../error.ts'
import type {
  Database,
  DatabaseRepository,
  DatabaseSummary,
  Version,
} from '../repository/database.repository.ts'
import type { ProductRepository } from '../repository/product.repository.ts'
import { assertColumns, type Column } from './column.ts'
import { allowedRoles, assertAllowed } from './permission.ts'
import type { ScopeResult } from './product.service.ts'
import { assertConfirmationName, requireMembership } from './product.service.ts'

export interface DatabaseView {
  id: string
  name: string
  description: string | null
  createdAt: number
  /** Includes changes to its design; sent back as `expectedUpdatedAt`. */
  updatedAt: number
}

/** One row of the product scope's database list ("各論 > データベース > 一覧"). */
export interface DatabaseListItemView extends DatabaseView {
  latestVersion: { id: string; number: number; status: VersionStatus }
  latestFinalVersion: { id: string; number: number } | null
  /** Of the latest version. */
  schemaCount: number
  tableCount: number
}

/** A version in the version history ("各論 > データベース > バージョンの状態"). */
export interface VersionView {
  id: string
  number: number
  status: VersionStatus
  /** The final version it was created from; null for v1. */
  sourceVersionId: string | null
  memo: string | null
  provisionalAt: number | null
  finalizedAt: number | null
  createdAt: number
  updatedAt: number
  schemaCount: number
  tableCount: number
}

/**
 * The database scope ("参照 > データの取得とキャッシュ": データベース): the database, its common
 * column set and every version, newest first. Deployments join it with automatic deployment.
 */
export interface DatabaseScopeView {
  database: DatabaseView
  commonColumns: Column[]
  versions: VersionView[]
}

export interface DatabaseService {
  getDatabase: (input: {
    userId: string
    productId: string
    databaseId: string
    clientRevision?: number
  }) => Promise<ScopeResult<DatabaseScopeView>>
  /** v1 (editing), optionally cloned from a final version of the same product. */
  createDatabase: (input: {
    userId: string
    productId: string
    name: string
    description: string
    sourceVersionId?: string
  }) => Promise<{ database: DatabaseListItemView; revisions: { product: number } }>
  updateDatabase: (input: {
    userId: string
    productId: string
    databaseId: string
    name: string
    description: string
    expectedUpdatedAt: number
  }) => Promise<{ database: DatabaseView; revisions: { product: number; database: number } }>
  /**
   * Replaces the common column set (any member). `expectedRevision` is the database scope's
   * revision the client edited from; columns already added to tables don't change.
   */
  saveCommonColumns: (input: {
    userId: string
    productId: string
    databaseId: string
    columns: Column[]
    expectedRevision: number
  }) => Promise<{ commonColumns: Column[]; revisions: { database: number } }>
  /** `confirmationName` must be the database's current name. */
  deleteDatabase: (input: {
    userId: string
    productId: string
    databaseId: string
    confirmationName: string
    expectedUpdatedAt: number
  }) => Promise<{ revisions: { product: number } }>
}

const toView = ({ id, name, description, createdAt, updatedAt }: Database): DatabaseView => ({
  id,
  name,
  description,
  createdAt,
  updatedAt,
})

const toVersionView = (version: Version): VersionView => ({
  id: version.id,
  number: version.number,
  status: version.status,
  sourceVersionId: version.sourceVersionId,
  memo: version.memo,
  provisionalAt: version.provisionalAt,
  finalizedAt: version.finalizedAt,
  createdAt: version.createdAt,
  updatedAt: version.updatedAt,
  schemaCount: version.schemaCount,
  tableCount: version.tableCount,
})

export const toDatabaseListItem = ({
  database,
  latestVersion,
  latestFinalVersion,
}: DatabaseSummary): DatabaseListItemView => ({
  ...toView(database),
  latestVersion: {
    id: latestVersion.id,
    number: latestVersion.number,
    status: latestVersion.status,
  },
  latestFinalVersion: latestFinalVersion ? { ...latestFinalVersion } : null,
  schemaCount: latestVersion.schemaCount,
  tableCount: latestVersion.tableCount,
})

// The schema a new database starts with ("各論 > データベース > 作成"); SQLite 3 has none.
const initialSchema = (target: Target): InitialSchema | null =>
  target === 'postgresql18'
    ? {
        id: crypto.randomUUID(),
        objectKey: crypto.randomUUID(),
        name: 'public',
        definition: '{}',
      }
    : null

// An empty description is no description.
const orNull = (description: string) => description || null

// Rewords the DAO's generic conflicts for the user.
const explain = (error: unknown): never => {
  if (error instanceof AppError && error.code === 'duplicate') {
    throw new AppError('duplicate', { message: '同じ名前のデータベースがすでにあります' })
  }
  if (error instanceof AppError && error.code === 'limit_exceeded') {
    throw new AppError('limit_exceeded', {
      message: `データベースは${LIMITS.databasesPerProduct}件までです`,
    })
  }
  throw error
}

/** Databases of a product ("各論 > データベース"): creation, name and description, deletion. */
export const createDatabaseService = (deps: {
  products: ProductRepository
  databases: DatabaseRepository
}): DatabaseService => {
  const authorize = async (productId: string, userId: string) => {
    const membership = await requireMembership(deps.products, productId, userId)
    assertAllowed(membership.role, 'manageDatabases')
    return membership
  }
  // A database of the product, or `not_found`.
  const find = async (productId: string, databaseId: string) => {
    const database = await deps.databases.findById(productId, databaseId)
    if (!database) throw new AppError('not_found')
    return database
  }
  const audit = (
    productId: string,
    userId: string,
    action: string,
    summary: string,
    now: number,
  ): AuditLogRecord => ({
    id: crypto.randomUUID(),
    productId,
    userId,
    targetType: 'database',
    action,
    summary,
    createdAt: now,
  })
  const actor = (userId: string) => ({ userId, allowedRoles: allowedRoles('manageDatabases') })

  return {
    getDatabase: async ({ userId, productId, databaseId, clientRevision }) => {
      await requireMembership(deps.products, productId, userId)
      // The database row is enough to answer "unchanged".
      const current = await find(productId, databaseId)
      if (current.revision === clientRevision) {
        return { mode: 'unchanged', revision: current.revision }
      }
      const scope = await deps.databases.findScope(productId, databaseId)
      if (!scope) throw new AppError('not_found')
      return {
        mode: 'full',
        revision: scope.database.revision,
        data: {
          database: toView(scope.database),
          // Validated when saved.
          commonColumns: scope.commonColumns as Column[],
          versions: scope.versions.toSorted((a, b) => b.number - a.number).map(toVersionView),
        },
      }
    },

    createDatabase: async ({ userId, productId, name, description, sourceVersionId }) => {
      const { product } = await authorize(productId, userId)
      const source = sourceVersionId
        ? await deps.databases.findVersion(productId, sourceVersionId)
        : null
      if (sourceVersionId && !source) throw new AppError('not_found')
      if (source && source.status !== 'final') throw new AppError('invalid_state')
      const now = Date.now()
      const database: Database = {
        id: crypto.randomUUID(),
        productId,
        name,
        description: orNull(description),
        createdAt: now,
        updatedAt: now,
        revision: 1,
      }
      const versionId = crypto.randomUUID()
      const schema = source ? null : initialSchema(product.target)
      const { productRevision } = await deps.databases
        .create({
          ...actor(userId),
          database,
          versionId,
          schema,
          sourceVersionId,
          maxDatabases: LIMITS.databasesPerProduct,
          audit: audit(productId, userId, 'create', name, now),
        })
        .catch(explain)
      return {
        database: toDatabaseListItem({
          database,
          latestVersion: {
            id: versionId,
            number: 1,
            status: 'editing',
            schemaCount: source?.schemaCount ?? (schema ? 1 : 0),
            tableCount: source?.tableCount ?? 0,
          },
          latestFinalVersion: null,
        }),
        revisions: { product: productRevision },
      }
    },

    updateDatabase: async ({
      userId,
      productId,
      databaseId,
      name,
      description,
      expectedUpdatedAt,
    }) => {
      await authorize(productId, userId)
      const current = await find(productId, databaseId)
      const now = Date.now()
      const { database, productRevision } = await deps.databases
        .update({
          ...actor(userId),
          productId,
          databaseId,
          name,
          description: orNull(description),
          expectedUpdatedAt,
          now,
          audit: audit(
            productId,
            userId,
            'update',
            current.name === name ? name : `${current.name} → ${name}`,
            now,
          ),
        })
        .catch(explain)
      return {
        database: toView(database),
        revisions: { product: productRevision, database: database.revision },
      }
    },

    saveCommonColumns: async ({ userId, productId, databaseId, columns, expectedRevision }) => {
      const { product, role } = await requireMembership(deps.products, productId, userId)
      assertAllowed(role, 'editCommonColumns')
      await find(productId, databaseId)
      assertColumns(product.target, columns, 'columns')
      const { revision } = await deps.databases.saveCommonColumns({
        productId,
        databaseId,
        commonColumns: columns,
        expectedRevision,
        userId,
        allowedRoles: allowedRoles('editCommonColumns'),
      })
      return { commonColumns: columns, revisions: { database: revision } }
    },

    deleteDatabase: async ({
      userId,
      productId,
      databaseId,
      confirmationName,
      expectedUpdatedAt,
    }) => {
      await authorize(productId, userId)
      const database = await find(productId, databaseId)
      assertConfirmationName(confirmationName, database.name)
      const now = Date.now()
      const { productRevision } = await deps.databases.delete({
        ...actor(userId),
        productId,
        databaseId,
        expectedUpdatedAt,
        now,
        audit: audit(productId, userId, 'delete', database.name, now),
      })
      return { revisions: { product: productRevision } }
    },
  }
}
