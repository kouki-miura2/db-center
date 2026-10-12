import { type QueryClient, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'

import { ApiError, call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { type Scope, scopeKeys } from '../cache/scope.ts'
import { updateProduct, updateScope } from '../cache/update.ts'
import type { DatabaseData } from './useDatabaseQuery.ts'

const databases = apiClient.api.products[':productId'].databases
const database = databases[':databaseId']
export type DatabaseInput = InferRequestType<typeof databases.$post>['json']
export const useDatabaseMutations = (productId: string, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const onError = async (error: unknown, input: { databaseId?: string }) => {
    if (error instanceof ApiError && error.code === 'stale_update') {
      await Promise.all([
        client.invalidateQueries({ queryKey: scopeKeys.product(productId), exact: true }),
        ...(input.databaseId
          ? [
              client.invalidateQueries({
                queryKey: scopeKeys.database(input.databaseId),
                exact: true,
              }),
            ]
          : []),
      ])
    }
  }
  const create = useMutation(
    {
      mutationFn: async (json: DatabaseInput) => {
        const result = await call(databases.$post({ param: { productId }, json }))
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          databases: [...data.databases, result.database].toSorted((a, b) =>
            a.name.localeCompare(b.name),
          ),
        }))
        return result.database
      },
    },
    client,
  )
  const rename = useMutation(
    {
      mutationFn: async (input: {
        databaseId: string
        json: InferRequestType<typeof database.$patch>['json']
      }) => {
        const result = await call(
          database.$patch({ param: { productId, databaseId: input.databaseId }, json: input.json }),
        )
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          databases: data.databases
            .map((row) => (row.id === input.databaseId ? { ...row, ...result.database } : row))
            .toSorted((a, b) => a.name.localeCompare(b.name)),
        }))
        updateScope<DatabaseData>(
          client,
          scopeKeys.database(input.databaseId),
          result.revisions.database,
          (data) => ({ ...data, database: result.database }),
        )
        return result.database
      },
      onError,
    },
    client,
  )
  const remove = useMutation(
    {
      mutationFn: async (input: {
        databaseId: string
        json: InferRequestType<typeof database.$delete>['json']
      }) => {
        const result = await call(
          database.$delete({
            param: { productId, databaseId: input.databaseId },
            json: input.json,
          }),
        )
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          databases: data.databases.filter((row) => row.id !== input.databaseId),
        }))
        const cached = client.getQueryData<Scope<DatabaseData>>(
          scopeKeys.database(input.databaseId),
        )
        for (const version of cached?.data.versions ?? [])
          client.removeQueries({ queryKey: scopeKeys.version(version.id) })
        client.removeQueries({ queryKey: scopeKeys.database(input.databaseId) })
      },
      onError,
    },
    client,
  )
  const saveCommonColumns = useMutation(
    {
      mutationFn: async (input: {
        databaseId: string
        json: InferRequestType<(typeof database)['common-columns']['$put']>['json']
      }) => {
        const result = await call(
          database['common-columns'].$put({
            param: { productId, databaseId: input.databaseId },
            json: input.json,
          }),
        )
        updateScope<DatabaseData>(
          client,
          scopeKeys.database(input.databaseId),
          result.revisions.database,
          (data) => ({ ...data, commonColumns: result.commonColumns }),
        )
      },
      onError,
    },
    client,
  )
  return { create, rename, remove, saveCommonColumns }
}
