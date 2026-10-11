# db-center

A tool that centralizes database design to improve development efficiency.

## Development

The frontend is served at `/` and the API at `/api` on the same origin, in development and in
production. Run both dev servers and open the frontend's URL; it proxies `/api` to the backend
(`localhost:8787`):

```bash
vp run dev-b   # backend
vp run dev-f   # frontend
```

In production, the backend runtime serves both: the Worker (`apps/backend-worker`) serves the
frontend build as static assets, and the Node.js server (`apps/backend-node`) serves it with
`serveStatic`. Both list `frontend` as a workspace dependency, so `vp run -r build` (or `-t` for
one package) builds the frontend once, before them; the Worker's `deploy` builds it itself.

- Check everything is ready:

```bash
vp run ready
```

- Run all tests:

```bash
vp run -r test
```

- Build everything:

```bash
vp run -r build
```

## packages/utils

- Run format/lint/type checks:

```bash
vp run utils#check
```

- Run the tests:

```bash
vp run utils#test
```

## apps/backend

Runtime-agnostic routes and business logic. Run it through `apps/backend-worker` or `apps/backend-node`.

- Run format/lint/type checks:

```bash
vp run backend#check
```

- Run the tests:

```bash
vp run backend#test
```

## apps/backend-worker

Runs `apps/backend` on Cloudflare Workers.

- Debug locally (reloads on changes in `apps/backend` too):

```bash
vp run backend-worker#dev
```

Local settings go in `apps/backend-worker/.dev.vars` (untracked):

```
DEV_LOGIN=true              # development login (POST /api/auth/dev-login) and an http session cookie
  # GOOGLE_CLIENT_ID=<web OAuth client id>   # only to try Google sign-in locally
  # ENCRYPTION_KEY=<32 random bytes, base64>   # to set connection passwords and invite users
```

Apply the D1 migrations to the local database first (and after adding one):

```bash
vp run backend-worker#migrate:local
```

- Build (frontend + dry-run Worker bundle):

```bash
vp run -t backend-worker#build
```

- Deploy (frontend + API, one Worker):

```bash
vp run backend-worker#deploy
```

Before the first deploy, set the Google OAuth client ID in both places (without it, Google sign-in is rejected):

- Backend: `npx wrangler secret put GOOGLE_CLIENT_ID` (run in `apps/backend-worker`).
- Frontend: `VITE_GOOGLE_WEB_CLIENT_ID` in `apps/frontend/.env.local`.

  Also set the encryption key for connection passwords and invitation passcodes (32 random bytes, base64,
  e.g. `node -e "console.log(crypto.randomBytes(32).toString('base64'))"`). Keep it: losing it makes stored
  passwords unreadable.

  - Backend: `npx wrangler secret put ENCRYPTION_KEY` (run in `apps/backend-worker`).

  Never set `DEV_LOGIN` for a deployed Worker.

- Regenerate Workers binding types:

```bash
vp run backend-worker#cf-typegen
```

## apps/frontend

- Run format/lint/type checks:

```bash
vp run frontend#check
```

- Run the tests:

```bash
vp run frontend#test
```

- Run the dev server:

```bash
vp run frontend#dev
```

- Build:

```bash
vp run frontend#build
```

- Preview the production build:

```bash
vp run frontend#preview
```
