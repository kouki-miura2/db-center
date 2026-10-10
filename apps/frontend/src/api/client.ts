import type { AppType } from 'backend/src/app.ts'
import { hc } from 'hono/client'

const REQUEST_TIMEOUT_MS = 3_000

/**
 * Hono RPC client. Request/response types are inferred from `AppType`, never hand-written.
 * The API is served under `/api` on the same origin as the frontend (proxied by Vite in dev).
 */
export const apiClient = hc<AppType>('/', {
  fetch: (input: RequestInfo | URL, init?: RequestInit) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) }),
})
