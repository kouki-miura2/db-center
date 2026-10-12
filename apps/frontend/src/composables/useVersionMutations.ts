import { type QueryClient, useMutation, useQueryClient } from '@tanstack/vue-query'

import { ApiError, call } from '../api/call.ts'
import { apiClient, LONG_REQUEST_TIMEOUT_MS, withTimeout } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { revisionAfterWrite, updateScope } from '../cache/update.ts'
import type { DatabaseData } from './useDatabaseQuery.ts'
import type { VersionData } from './useVersionQuery.ts'

// The version's life: provisional (after the checks), back to editing, final, and a new version
// from a final one ("各論 > データベース > バージョンの状態"). Every change writes the returned
// version into the version and database scopes; the product scope (its database list shows the
// latest versions) is checked again.

const versions = apiClient.api.versions[':versionId']
const databaseVersions = apiClient.api.products[':productId'].databases[':databaseId'].versions

type VersionRecord = VersionData['version']
type DatabaseVersion = DatabaseData['versions'][number]

/** What a change is checked against: the version as the screen showed it. */
export interface VersionExpectation {
  versionId: string
  expectedUpdatedAt: number
  expectedRevision: number
}

export type ValidationResult = Awaited<ReturnType<typeof validateVersion>>

const validateVersion = (versionId: string) =>
  call(versions.validate.$post({ param: { versionId } }, withTimeout(LONG_REQUEST_TIMEOUT_MS)))

/** The database's versions with `changed` in, newest first. */
export const withVersion = (list: DatabaseVersion[], changed: VersionRecord): DatabaseVersion[] =>
  [...list.filter((v) => v.id !== changed.id), changed as DatabaseVersion].toSorted(
    (a, b) => b.number - a.number,
  )

export const useVersionMutations = (
  productId: string,
  databaseId: string,
  queryClient?: QueryClient,
) => {
  const client = queryClient ?? useQueryClient()

  const apply = (changed: VersionRecord[], revisions: { version: number; database: number }) => {
    for (const version of changed) {
      const key = scopeKeys.version(version.id)
      updateScope<VersionData>(
        client,
        key,
        revisionAfterWrite(client, key, revisions.version),
        (data) => ({ ...data, version }),
      )
    }
    const key = scopeKeys.database(databaseId)
    updateScope<DatabaseData>(
      client,
      key,
      revisionAfterWrite(client, key, revisions.database),
      (data) => ({
        ...data,
        versions: changed.reduce((list, version) => withVersion(list, version), data.versions),
      }),
    )
    void client.invalidateQueries({ queryKey: scopeKeys.product(productId), exact: true })
  }

  const onError = async (error: unknown, input: { versionId: string }) => {
    if (error instanceof ApiError && error.code === 'stale_update')
      await Promise.all([
        client.invalidateQueries({ queryKey: scopeKeys.version(input.versionId), exact: true }),
        client.invalidateQueries({ queryKey: scopeKeys.database(databaseId), exact: true }),
      ])
  }

  /** The checks of "仮確定のチェック" and the changes since the previous final version. */
  const validate = useMutation({ mutationFn: validateVersion }, client)

  /** Provisional when the checks find no error; otherwise the checks come back. */
  const provisional = useMutation(
    {
      mutationFn: async ({ versionId, ...json }: VersionExpectation & { memo: string | null }) => {
        const result = await call(
          versions.provisional.$post(
            { param: { versionId }, json },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        )
        if (result.transitioned) apply([result.version], result.revisions)
        return result
      },
      onError,
    },
    client,
  )

  /** Back to editing; `requiresConfirmation` when a connection had it applied. */
  const revert = useMutation(
    {
      mutationFn: async ({
        versionId,
        ...json
      }: VersionExpectation & { memo: string | null; acknowledgeApplied: boolean }) => {
        const result = await call(versions.revert.$post({ param: { versionId }, json }))
        if (result.transitioned) apply([result.version], result.revisions)
        return result
      },
      onError,
    },
    client,
  )

  const finalize = useMutation(
    {
      mutationFn: async ({
        versionId,
        ...json
      }: VersionExpectation & { memo: string | null; createNext: boolean }) => {
        const result = await call(versions.finalize.$post({ param: { versionId }, json }))
        apply(
          result.createdVersion ? [result.version, result.createdVersion] : [result.version],
          result.revisions,
        )
        return result
      },
      onError,
    },
    client,
  )

  /** Each connection's applied version, read from the connection, before finalizing. */
  const finalizePreview = useMutation(
    {
      mutationFn: (versionId: string) =>
        call(
          versions['finalize-preview'].$post(
            { param: { versionId }, json: {} },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        ),
    },
    client,
  )

  /** A new editing version cloned from a final one. */
  const create = useMutation(
    {
      mutationFn: async ({ versionId, ...expected }: VersionExpectation) => {
        const result = await call(
          databaseVersions.$post({
            param: { productId, databaseId },
            json: { sourceVersionId: versionId, ...expected },
          }),
        )
        apply([result.version], result.revisions)
        return result.version
      },
      onError,
    },
    client,
  )

  return { validate, provisional, revert, finalize, finalizePreview, create }
}
