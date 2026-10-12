import { type QueryClient, useMutation, useQueryClient } from '@tanstack/vue-query'
import type { InferRequestType } from 'hono/client'

import { call } from '../api/call.ts'
import { apiClient } from '../api/client.ts'
import { removeProductCache, updateProduct, updateProductList } from '../cache/update.ts'
import { useAuthStore } from '../stores/auth.ts'

const product = apiClient.api.products[':productId']
export type Invitees = InferRequestType<typeof product.invitations.$post>['json']['invitees']
export const useMemberMutations = (productId: string, queryClient?: QueryClient) => {
  const client = queryClient ?? useQueryClient()
  const auth = useAuthStore()
  const param = { productId }
  const invite = useMutation(
    {
      mutationFn: async (invitees: Invitees) => {
        const result = await call(product.invitations.$post({ param, json: { invitees } }))
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          invitations: [
            ...data.invitations.filter(
              (row) => !result.invitations.some((added) => added.email === row.email),
            ),
            ...result.invitations,
          ].toSorted((a, b) => a.email.localeCompare(b.email)),
        }))
        return { passcode: result.passcode, expiresAt: result.expiresAt }
      },
    },
    client,
  )
  const passcode = useMutation(
    {
      mutationFn: (invitationId: string) =>
        call(
          product.invitations[':invitationId'].passcode.$post({
            param: { ...param, invitationId },
          }),
        ),
    },
    client,
  )
  const changeRole = useMutation(
    {
      mutationFn: async (input: { userId: string; role: 'manager' | 'member' }) => {
        const result = await call(
          product.members[':userId'].$patch({
            param: { ...param, userId: input.userId },
            json: { role: input.role },
          }),
        )
        const own = auth.user?.id === input.userId
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          role: own ? input.role : data.role,
          members: data.members.map((row) =>
            row.userId === input.userId ? { ...row, role: input.role } : row,
          ),
        }))
        updateProductList(client, result.revisions.products, (rows) =>
          rows.map((row) => (own && row.id === productId ? { ...row, role: input.role } : row)),
        )
      },
    },
    client,
  )
  const removeMember = useMutation(
    {
      mutationFn: async (userId: string) => {
        const result = await call(
          product.members[':userId'].$delete({ param: { ...param, userId } }),
        )
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          members: data.members.filter((row) => row.userId !== userId),
        }))
        updateProductList(client, result.revisions.products, (rows) => rows)
      },
    },
    client,
  )
  const transfer = useMutation(
    {
      mutationFn: async (userId: string) => {
        const result = await call(product['transfer-owner'].$post({ param, json: { userId } }))
        updateProduct(client, productId, result.revisions.product, (data) => ({
          ...data,
          role: 'manager',
          members: data.members.map((row) =>
            row.userId === userId
              ? { ...row, role: 'owner' }
              : row.role === 'owner'
                ? { ...row, role: 'manager' }
                : row,
          ),
        }))
        updateProductList(client, result.revisions.products, (rows) =>
          rows.map((row) => (row.id === productId ? { ...row, role: 'manager' } : row)),
        )
      },
    },
    client,
  )
  const leave = useMutation(
    {
      mutationFn: async () => {
        const result = await call(product.leave.$post({ param }))
        updateProductList(client, result.revisions.products, (rows) =>
          rows.filter((row) => row.id !== productId),
        )
        removeProductCache(client, productId)
      },
    },
    client,
  )
  const join = useMutation(
    {
      mutationFn: async (passcode: string) => {
        const result = await call(apiClient.api.invitations.join.$post({ json: { passcode } }))
        updateProductList(client, result.revisions.products, (rows) => [
          ...rows.filter((row) => row.id !== result.product.id),
          result.product,
        ])
        return result.product
      },
    },
    client,
  )
  return { invite, passcode, changeRole, removeMember, transfer, leave, join }
}
