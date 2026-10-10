# apps/backend-worker

- Cloudflare Workers entrypoint for `apps/backend`. `src/worker.ts` wires concrete dependencies (DAO → repository → service) into `createApp` from `backend/src/app.ts` and exports the app; routes and business logic stay in `apps/backend`.
- Workers-only code lives here, never in `apps/backend`: DAOs backed by Cloudflare bindings (`src/dao/*.d1.ts`, KV, R2, ...) implementing the interfaces in `backend/src/dao/*.interface.ts`, and anything that touches `env` bindings.
- One Worker serves the whole app: `apps/backend` at `/api`, and the `apps/frontend` build (`../frontend/dist`) at `/` as static assets (`assets` in `wrangler.jsonc`: SPA fallback to `index.html`, `run_worker_first` for `/api/*`; response headers come from `apps/frontend/public/_headers`). `frontend` is a devDependency only to order builds: run `vp run -t backend-worker#build` (or `vp run -r build`) so the frontend builds once before the dry-run bundle; `deploy` builds the frontend itself. `dev` only creates an empty `../frontend/dist` if missing, since in development the frontend is served by `vp run frontend#dev` (which proxies `/api` here).
- Config is `wrangler.jsonc`. After adding bindings, run `vp run backend-worker#cf-typegen` to regenerate `worker-configuration.d.ts` (untracked).
- Secrets: use `wrangler secret put`, never `.env` / commit `.dev.vars`.
