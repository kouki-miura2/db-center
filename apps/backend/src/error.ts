import type { Context } from 'hono'
import { HTTPException } from 'hono/http-exception'
import type { ContentfulStatusCode } from 'hono/utils/http-status'

/**
 * Every error the API returns, with its HTTP status and default message (shown to the user).
 * Services throw `AppError` with one of these codes and never deal with HTTP; `errorResponse`
 * turns it into `{ error: { code, message, fields? }, requestId }`.
 * Not found, not a member, another product's ID and deleted parents are all `not_found`, so a
 * response never reveals that something exists.
 */
const ERRORS = {
  invalid_input: { status: 400, message: '入力内容に誤りがあります' },
  unauthorized: { status: 401, message: 'ログインしてください' },
  forbidden: { status: 403, message: 'この操作を行う権限がありません' },
  consent_required: {
    status: 403,
    message: '利用規約・プライバシーポリシーへの同意が必要です',
  },
  not_found: { status: 404, message: '対象が見つかりません' },
  stale_update: { status: 409, message: '他のユーザーが更新しました。再読み込みしてください' },
  limit_exceeded: { status: 409, message: '上限に達しています' },
  duplicate: { status: 409, message: '同じ名前がすでに使われています' },
  invalid_state: { status: 409, message: '現在の状態ではこの操作はできません' },
  too_many_attempts: {
    status: 429,
    message: '入力の失敗が続いたため、しばらく入力できません',
  },
  internal: { status: 500, message: 'サーバーでエラーが発生しました' },
} as const satisfies Record<string, { status: ContentfulStatusCode; message: string }>

export type ErrorCode = keyof typeof ERRORS

/** Per-field messages for `invalid_input`, keyed by the field's path (`columns.0.name`). */
export type ErrorFields = Record<string, string>

export class AppError extends Error {
  readonly code: ErrorCode
  readonly fields: ErrorFields | undefined

  constructor(code: ErrorCode, options: { message?: string; fields?: ErrorFields } = {}) {
    super(options.message ?? ERRORS[code].message)
    this.code = code
    this.fields = options.fields
  }
}

// Errors Hono itself raises (malformed JSON, the CSRF middleware's 403, ...), by status.
const httpExceptionCode = (status: number): ErrorCode =>
  status === 400
    ? 'invalid_input'
    : status === 401
      ? 'unauthorized'
      : status === 403
        ? 'forbidden'
        : status === 404
          ? 'not_found'
          : 'internal'

/** The JSON error response for an `AppError`, a Hono `HTTPException` or anything else (500). */
export const errorResponse = (c: Context, error: unknown) => {
  const appError =
    error instanceof AppError
      ? error
      : new AppError(error instanceof HTTPException ? httpExceptionCode(error.status) : 'internal')
  const { status } = ERRORS[appError.code]
  const fields = appError.fields ? { fields: appError.fields } : {}
  return c.json(
    {
      error: { code: appError.code, message: appError.message, ...fields },
      requestId: c.get('requestId') as string,
    },
    status,
  )
}
