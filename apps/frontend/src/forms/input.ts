import { charLength } from 'utils'

import { ApiError } from '../api/call.ts'

export const required = (value: string) => !!value.trim() || '入力してください'
export const maxLength = (max: number) => (value: string) =>
  charLength(value) <= max || `${max}文字以内で入力してください`
export const fieldError = (error: unknown, path: string) =>
  error instanceof ApiError ? error.fields?.[path] : undefined
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作に失敗しました'
