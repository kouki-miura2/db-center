import { type QueryClient, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'

import { ApiError, call } from '../api/call.ts'
import { apiClient, withTimeout, LONG_REQUEST_TIMEOUT_MS } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { updateScope } from '../cache/update.ts'
import type { DatabaseData } from './useDatabaseQuery.ts'
import { mergeObjects, type VersionData } from './useVersionQuery.ts'

const versions = apiClient.api.versions[':versionId']
export type ObjectInput = InferRequestType<
  (typeof versions.objects)[':objectKey']['$put']
>['json']['input']
export const useObjectMutations = (
  productId: string,
  databaseId: string,
  queryClient?: QueryClient,
) => {
  const client = queryClient ?? useQueryClient()
  const onError = async (error: unknown, input: { versionId: string }) => {
    if (error instanceof ApiError && error.code === 'stale_update')
      await Promise.all([
        client.invalidateQueries({ queryKey: scopeKeys.version(input.versionId), exact: true }),
        client.invalidateQueries({ queryKey: scopeKeys.database(databaseId), exact: true }),
        client.invalidateQueries({ queryKey: scopeKeys.product(productId), exact: true }),
      ])
  }
  const save = useMutation(
    {
      mutationFn: async (input: {
        versionId: string
        objectKey: string
        expectedUpdatedAt?: number
        input: ObjectInput
      }) => {
        const { versionId, objectKey, expectedUpdatedAt } = input
        const result = await call(
          expectedUpdatedAt === undefined
            ? versions.objects.$post(
                { param: { versionId }, json: { ...input.input, objectKey } },
                withTimeout(LONG_REQUEST_TIMEOUT_MS),
              )
            : versions.objects[':objectKey'].$put(
                {
                  param: { versionId, objectKey },
                  json: { input: input.input, expectedUpdatedAt },
                },
                withTimeout(LONG_REQUEST_TIMEOUT_MS),
              ),
        )
        const cachedRevision =
          client.getQueryData<{ revision: number }>(scopeKeys.version(versionId))?.revision ?? 0
        // A gap means another member wrote an object not contained in this response. Keep the
        // earlier revision in that case so a later delta cannot silently skip their change.
        updateScope<VersionData>(
          client,
          scopeKeys.version(versionId),
          result.revisions.version === cachedRevision + 1
            ? result.revisions.version
            : cachedRevision,
          (data) => ({
            ...data,
            version: result.version,
            objects: mergeObjects(data.objects, [result.object], []),
          }),
        )
        const databaseRevision =
          client.getQueryData<{ revision: number }>(scopeKeys.database(databaseId))?.revision ?? 0
        updateScope<DatabaseData>(
          client,
          scopeKeys.database(databaseId),
          databaseRevision,
          (data) => ({
            ...data,
            versions: data.versions.map((v) => (v.id === versionId ? result.version : v)),
          }),
        )
        return result.object
      },
      onError,
    },
    client,
  )
  const remove = useMutation(
    {
      mutationFn: async (input: {
        versionId: string
        objectKey: string
        expectedUpdatedAt: number
        confirmationName: string
      }) => {
        const result = await call(
          versions.objects[':objectKey'].$delete({
            param: { versionId: input.versionId, objectKey: input.objectKey },
            json: {
              expectedUpdatedAt: input.expectedUpdatedAt,
              confirmationName: input.confirmationName,
            },
          }),
        )
        const cachedRevision =
          client.getQueryData<{ revision: number }>(scopeKeys.version(input.versionId))?.revision ??
          0
        updateScope<VersionData>(
          client,
          scopeKeys.version(input.versionId),
          result.revisions.version === cachedRevision + 1
            ? result.revisions.version
            : cachedRevision,
          (data) => ({
            ...data,
            version: result.version,
            objects: mergeObjects(data.objects, [], [input.objectKey]),
          }),
        )
      },
      onError,
    },
    client,
  )
  const validateView = useMutation(
    {
      mutationFn: (input: {
        versionId: string
        json: InferRequestType<(typeof versions)['view-validation']['$post']>['json']
      }) =>
        call(
          versions['view-validation'].$post(
            { param: { versionId: input.versionId }, json: input.json },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        ),
    },
    client,
  )
  const ddl = useMutation(
    {
      mutationFn: (versionId: string) =>
        call(
          versions.ddl.$post(
            {
              param: { versionId },
              json: {
                options: {
                  includeSchemas: true,
                  includeComments: true,
                  transaction: false,
                  ifNotExists: false,
                  versionTable: false,
                  dropExisting: false,
                },
              },
            },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        ),
    },
    client,
  )
  const tableDdl = useMutation(
    {
      mutationFn: (input: {
        versionId: string
        json: InferRequestType<(typeof versions)['table-ddl']['$post']>['json']
      }) =>
        call(
          versions['table-ddl'].$post(
            { param: { versionId: input.versionId }, json: input.json },
            withTimeout(LONG_REQUEST_TIMEOUT_MS),
          ),
        ),
    },
    client,
  )
  return { save, remove, validateView, ddl, tableDdl }
}
