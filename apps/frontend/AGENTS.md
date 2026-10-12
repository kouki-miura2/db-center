# apps/frontend

- Vue 3 (Composition API, `<script setup>`).
- Vuetify 4 for UI components and theming.
- vue-router for routing. The route table lives in `src/router/routes.ts`, separate from `src/router/index.ts` (which builds the actual `router` with `createWebHistory()`), so tests can import `routes` without pulling in a browser-only history.
- TanStack Query (`@tanstack/vue-query`, `VueQueryPlugin` installed in `src/main.ts`) for server state — see State below.
- API access goes through a Hono RPC client (`hc<AppType>()`), built from a type-only import of `apps/backend`'s `AppType`. This gives full request/response type inference without a shared types package or manually written DTOs. The API is same-origin under `/api` (client base `/`, so routes are `apiClient.api.*`); in dev, `vite.config.ts` proxies `/api` to the backend dev server on `localhost:8787`.
- TypeScript is pinned to `^6.x` here, independent of the workspace catalog's `^7.x`: `vue-tsc`/Vue Language Tools can't type-check `.vue` SFCs against TypeScript 7's native compiler yet (no public Program API). Re-sync to the catalog once vue-tsc supports it.

## State

State is split by kind — don't reach for Pinia as a catch-all:

- Server state (API responses, caching, fetching/loading/error) goes through TanStack Query (`@tanstack/vue-query`) via `useQuery`/`useMutation`, each wrapped in its own composable under `src/composables/` (`useXxxQuery.ts`) rather than called inline in components. Never store API response data in a Pinia store.
  - The app has one `QueryClient` (`src/plugins/query.ts`): no refetch on focus, reconnect or an interval, `staleTime` = `LIMITS.revisionCheckMinutes`, and the cache persisted to IndexedDB per user (`src/cache/persist.ts`, started and cleared by `src/auth/session.ts`).
  - Call the API through `call()` (`src/api/call.ts`): it returns the JSON body and throws an `ApiError` (`code`, `message`, `fields`) for an error response or no response (`network`). An expired session (`unauthorized`) and new terms (`consent_required`) are handled app-wide (`listenForAuthErrors`), not per screen. Pass `withTimeout(LONG_REQUEST_TIMEOUT_MS)` (`src/api/client.ts`) for calls slower than 3 seconds.
  - A cacheable scope (`docs/spec.md` "参照 > データの取得とキャッシュ") is one query under its `scopeKeys` key whose `queryFn` is `fetchScope` (`src/cache/scope.ts`), so it sends the cached revision and keeps the cache when unchanged; `useRevisionCheck` re-checks the scopes on screen when the app returns to the front or online. After a mutation, write the data and revisions the API returns into the cache with `queryClient.setQueryData` instead of refetching.
- Pinia (`src/stores`, one store per domain) is for global UI state only — auth info, theme, notifications, and other state shared app-wide that isn't server data. Define stores with the setup-function style, not the Options style, and don't call `fetch`/`axios` from inside a Pinia action; that's TanStack Query's job. `src/stores/auth.ts` (the signed-in user; its API calls live in `src/auth/session.ts`) and `src/stores/notification.ts` (the app-wide snackbar) are worked references.
- Local/component state (modal open/closed, form inputs, per-component derived values) stays in composables or component `ref`s — don't promote it to Pinia just because it's convenient.
- Don't destructure values out of `props` or a `reactive` object; it breaks reactivity. Use `toRefs()` or `toValue()` instead. Default to `ref()` for single values, `reactive()` only for grouping related fields (e.g. a form's values), and `ref()` when in doubt.
- When sharing state via `provide`/`inject`, type the key with `InjectionKey<T>` and expose access through a composable (e.g. `useMyContext()`) instead of calling `inject` directly at each call site.

## Testing

Tests run in Node (no jsdom/happy-dom), so keep test subjects DOM-free — test composables, stores, router config, and API wiring directly rather than mounting components. Run with `vp test` / `vp run frontend#test`.

- API client (`src/api/client.test.ts`): smoke-test that `apiClient` exposes the expected typed RPC methods.
- Pinia stores (`src/stores/notification.test.ts`): call `setActivePinia(createPinia())` in `beforeEach`, then `useXxxStore()` and assert directly — no app mount needed.
- API calls and caches (`src/auth/session.test.ts`): `vi.mock` `../api/client.ts` (and `idb-keyval`), answering with `{ ok, status, json }` objects. Keep the logic in plain functions where possible (`src/cache/revision-check.ts`, `src/router/guard.ts`) and test those directly.
- Composables: `vi.mock` `../api/client.ts`, then run the composable inside `effectScope().run(...)`, passing an explicit `queryClient` (a plain `new QueryClient(...)`, `retry: false`) as the composable's second argument instead of installing `VueQueryPlugin` on a mounted app. Await state changes with `vi.waitFor(() => expect(query.isSuccess.value).toBe(true))` rather than a fixed delay.
- Router (`src/router/routes.test.ts`): build a throwaway router from the exported `routes` with vue-router's `createMemoryHistory()` (no real browser history needed), and assert with `router.resolve(...)` rather than `router.push(...)` — `push` actually loads the matched route's lazy component, which drags in Vuetify's CSS and breaks under Node's module loader.
