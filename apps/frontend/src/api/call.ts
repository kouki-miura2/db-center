/** A failed API call: the API's error code (`apps/backend/src/error.ts`), or `network`. */
export class ApiError extends Error {
  readonly code: string
  readonly status: number | null
  /** Per-field messages of `invalid_input`, keyed by the field's path (`columns.0.name`). */
  readonly fields: Record<string, string> | undefined

  constructor(
    code: string,
    message: string,
    options: { status?: number; fields?: Record<string, string> } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = options.status ?? null
    this.fields = options.fields
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string; fields?: Record<string, string> }
}

const NETWORK_MESSAGE = '通信できませんでした。接続を確認してください'
const TIMEOUT_MESSAGE = '通信がタイムアウトしました。時間をおいて再度お試しください'

/** Whether the request never got an answer (offline, timed out), not an error from the API. */
export const isNetworkError = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'network'

/**
 * Awaits a Hono RPC request and returns its JSON body (`undefined` for 204). An error response
 * (`{ error: { code, message, fields? } }`) or no response at all is thrown as an `ApiError`, so
 * TanStack Query sees it as an error.
 */
export const call = async <T>(
  request: Promise<{ ok: boolean; status: number; json: () => Promise<T> }>,
): Promise<T> => {
  let res: Awaited<typeof request>
  try {
    res = await request
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'TimeoutError'
    throw new ApiError('network', timedOut ? TIMEOUT_MESSAGE : NETWORK_MESSAGE)
  }
  if (res.ok) return res.status === 204 ? (undefined as T) : res.json()
  const body = (await res.json().catch(() => ({}))) as ErrorBody
  throw new ApiError(
    body.error?.code ?? 'internal',
    body.error?.message ?? 'サーバーでエラーが発生しました',
    { status: res.status, fields: body.error?.fields },
  )
}
