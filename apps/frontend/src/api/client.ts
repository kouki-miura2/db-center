import type { AppType } from 'backend/src/app.ts'
import { hc } from 'hono/client'

const REQUEST_TIMEOUT_MS = 3_000

/** For requests that take longer (scripts, definitions, checks against a connection). */
export const LONG_REQUEST_TIMEOUT_MS = 60_000

/** Request options for a call that may take up to `ms`, instead of the default 3 seconds. */
export const withTimeout = (ms: number) => ({ init: { signal: AbortSignal.timeout(ms) } })

/**
 * Hono RPC client. Request/response types are inferred from `AppType`, never hand-written.
 * The API is served under `/api` on the same origin as the frontend (proxied by Vite in dev).
 * Every request times out (3 seconds unless the call passes its own signal, `withTimeout`).
 */
export const apiClient = hc<AppType>('/', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, signal: init?.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
})
