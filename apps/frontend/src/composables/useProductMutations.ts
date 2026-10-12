import { type QueryClient, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'
import { type MaybeRefOrGetter, toValue } from 'vue'

import { ApiError, call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { scopeKeys } from '../cache/scope.ts'
import { removeProductCache, updateProduct, updateProductList } from '../cache/update.ts'

const products = apiClient.api.products
const product = products[':productId']
const connection = product.connections[':connectionId']
type Json<F extends (...args: never[]) => unknown> =
  InferRequestType<F> extends { json: infer J } ? J : never
type Create = Json<typeof products.$post>
type Rename = Json<typeof product.$patch>
type Delete = Json<typeof product.$delete>
type AddConnection = Json<typeof product.connections.$post>
type EditConnection = Json<typeof connection.$patch>

export const useProductMutations = (
  productId: MaybeRefOrGetter<string>,
  queryClient?: QueryClient,
) => {
  const client = queryClient ?? useQueryClient()
  const param = () => ({ productId: toValue(productId) })
  const onError = async (error: unknown) => {
    if (error instanceof ApiError && error.code === 'stale_update') {
      await client.invalidateQueries({
        queryKey: scopeKeys.product(toValue(productId)),
        exact: true,
      })
    }
  }
  const create = useMutation(
    {
      mutationFn: async (json: Create) => {
        const result = await call(products.$post({ json }))
        updateProductList(client, result.revisions.products, (rows) => [...rows, result.product])
        return result.product
      },
    },
    client,
  )
  const rename = useMutation(
    {
      mutationFn: async (json: Rename) => {
        const result = await call(product.$patch({ param: param(), json }))
        updateProduct(client, toValue(productId), result.revisions.product, (data) => ({
          ...data,
          product: result.product,
        }))
        updateProductList(client, result.revisions.products, (rows) =>
          rows.map((row) => (row.id === toValue(productId) ? { ...row, ...result.product } : row)),
        )
        return result.product
      },
      onError,
    },
    client,
  )
  const remove = useMutation(
    {
      mutationFn: async (json: Delete) => {
        const result = await call(product.$delete({ param: param(), json }))
        updateProductList(client, result.revisions.products, (rows) =>
          rows.filter((row) => row.id !== toValue(productId)),
        )
        removeProductCache(client, toValue(productId))
      },
      onError,
    },
    client,
  )
  const addConnection = useMutation(
    {
      mutationFn: async (input: { productId?: string; json: AddConnection }) => {
        const id = input.productId ?? toValue(productId)
        const result = await call(
          product.connections.$post({ param: { productId: id }, json: input.json }),
        )
        updateProduct(client, id, result.revisions.product, (data) => ({
          ...data,
          connections: [...data.connections, result.connection],
        }))
        return result.connection
      },
      onError,
    },
    client,
  )
  const editConnection = useMutation(
    {
      mutationFn: async (input: { connectionId: string; json: EditConnection }) => {
        const result = await call(
          connection.$patch({
            param: { ...param(), connectionId: input.connectionId },
            json: input.json,
          }),
        )
        updateProduct(client, toValue(productId), result.revisions.product, (data) => ({
          ...data,
          connections: data.connections.map((row) =>
            row.id === result.connection.id ? result.connection : row,
          ),
        }))
        return result.connection
      },
      onError,
    },
    client,
  )
  const deleteConnection = useMutation(
    {
      mutationFn: async (input: { connectionId: string; expectedUpdatedAt: number }) => {
        const { connectionId, expectedUpdatedAt } = input
        const result = await call(
          connection.$delete({ param: { ...param(), connectionId }, json: { expectedUpdatedAt } }),
        )
        updateProduct(client, toValue(productId), result.revisions.product, (data) => ({
          ...data,
          connections: data.connections.filter((row) => row.id !== connectionId),
        }))
        // Connection deletion changes the labels in deployment history: keep database revisions old
        // so their next scope check fetches those changes.
      },
      onError,
    },
    client,
  )
  const reorder = useMutation(
    {
      mutationFn: async (json: Json<typeof product.connections.order.$put>) => {
        const result = await call(product.connections.order.$put({ param: param(), json }))
        updateProduct(client, toValue(productId), result.revisions.product, (data) => ({
          ...data,
          connections: data.connections
            .map((row) => ({ ...row, sortOrder: json.connectionIds.indexOf(row.id) }))
            .toSorted((a, b) => a.sortOrder - b.sortOrder),
        }))
      },
      onError,
    },
    client,
  )
  return { create, rename, remove, addConnection, editConnection, deleteConnection, reorder }
}
