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

In production, the Worker (`apps/backend-worker`) serves both: the API, and the frontend build as
static assets. It lists `frontend` as a workspace dependency, so `vp run -r build` (or
`vp run -t backend-worker#build`) builds the frontend once, before it.

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

Runtime-agnostic routes and business logic. Run it through `apps/backend-worker`.

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

- Deploy (frontend + API, one Worker): see "Deploying to Cloudflare" below.
  (`vp run backend-worker#deploy` deploys `wrangler.jsonc` as it is, without the per-environment
  settings those steps add.)

### Deploying to Cloudflare

One Worker serves the frontend at `/` and the API at `/api`. Automatic PostgreSQL
deployments (build/migration) need **Workers Paid**; on the free plan, leave out the R2 bucket
and the Workflow below and the app runs with automatic execution disabled (script export still
works).

Account-specific values (the D1 database ID, the R2 bucket name, the Workflow name) never go in a
tracked file. They live in `apps/backend-worker/wrangler.local.jsonc` (gitignored), a copy of
`wrangler.jsonc` with them added. Run every command below in `apps/backend-worker`.

1. **Create the resources** (once per environment):

   ```bash
   vp exec wrangler d1 create db-center
   vp exec wrangler r2 bucket create <bucket>      # automatic deployments only
   ```

2. **Write `wrangler.local.jsonc`**: copy `wrangler.jsonc` and add the database ID printed by
   `d1 create` to the `DB` binding, plus (automatic deployments only) the bucket and the Workflow:

   ```jsonc
   {
     // ...everything from wrangler.jsonc, then:
     "d1_databases": [
       {
         "binding": "DB",
         "database_name": "db-center",
         "database_id": "<database id>",
         "migrations_dir": "migrations",
       },
     ],
     "r2_buckets": [{ "binding": "DEPLOYMENT_SQL", "bucket_name": "<bucket>" }],
     "workflows": [
       {
         "binding": "DEPLOYMENT_WORKFLOW",
         "name": "<workflow name>",
         "class_name": "DeploymentWorkflowEntrypoint",
       },
     ],
   }
   ```

   The daily cleanup's Cron Trigger (`triggers.crons`, 03:00 JST) comes along with the copy.
   Keep the R2 bucket private: no public access, no custom domain. Regenerate the binding types
   with `vp exec wrangler types --config wrangler.local.jsonc`.

3. **Set the secrets** of the Worker:

   ```bash
   vp exec wrangler secret put GOOGLE_CLIENT_ID --config wrangler.local.jsonc
   vp exec wrangler secret put ENCRYPTION_KEY --config wrangler.local.jsonc
   ```

   - `GOOGLE_CLIENT_ID`: the web OAuth client ID. Unset, every Google sign-in is rejected.
   - `ENCRYPTION_KEY`: 32 random bytes in base64
     (`node -e "console.log(crypto.randomBytes(32).toString('base64'))"`), encrypting connection
     passwords and invitation passcodes. Unset, setting a password or inviting is refused. Keep a
     copy: losing it makes stored passwords unreadable.
   - Never set `DEV_LOGIN` on a deployed Worker.

4. **Set the frontend's public values** in `apps/frontend/.env.local` (gitignored; build-time,
   readable by anyone who can open the app):

   ```
   VITE_GOOGLE_WEB_CLIENT_ID=<the same web OAuth client ID>
   VITE_OPERATOR_NAME=<operator name shown in the terms and privacy policy>
   VITE_CONTACT_EMAIL=<contact email shown in the terms and privacy policy>
   ```

5. **Apply the D1 migrations** (first deploy, and every time `migrations/` gains a file), before
   deploying the code that needs them:

   ```bash
   vp exec wrangler d1 migrations apply DB --remote --config wrangler.local.jsonc
   ```

6. **Build and deploy**:

   ```bash
   vp run frontend#build
   vp exec wrangler deploy --config wrangler.local.jsonc
   ```

   Only the build output is deployed: never upload `.env*`, `.dev.vars`, local databases or
   source maps.

### Operating it

- **Logs**: Workers Logs (`observability` in `wrangler.jsonc`) hold the request log and the daily
  job's JSON lines: `maintenance task completed` / `maintenance task failed` per task,
  `purged` / `purge postponed` / `purge failed` per product or database, and
  `deployment reconciled` per deployment, each with the IDs involved and never a password,
  token or passcode.
- **The daily job** (`scheduled` in `src/worker.ts`) deletes expired sessions and invitations,
  replaces expired invitees' emails in the audit log, deletes old passcode failures and audit log
  entries, purges products and databases deleted past their retention, and reconciles deployments
  left running. Every task is safe to run again: a failed or cut-short run is completed by the
  next one. To run it on demand locally: `vp exec wrangler dev --test-scheduled`, then open
  `http://localhost:8787/__scheduled`.
- **A purge keeps being postponed**: the log's `reason` says why. `deployment_running` waits for
  the deployment to end (see below); `storage_not_configured` means a product or database with
  deployment SQL in R2 but no `DEPLOYMENT_SQL` binding, so add the binding back. A failed R2
  delete leaves the D1 rows in place, and the next run deletes again (already deleted keys are
  skipped).

### When an automatic deployment goes wrong

Deployment SQL and its frozen plan are stored once under `deployments/<id>.sql` and
`deployments/<id>.json`. The Workflow payload holds only the execution ID; passwords stay
encrypted in D1. DDL is never retried automatically and never replayed: do not run a
deployment's SQL again by hand to "finish" it.

- **Stuck as running**: the daily job reconciles every deployment still running some time after
  it was accepted (`LIMITS.deploymentReconcileMinutes`; one that is executing waits for
  `LIMITS.deploymentWorkflowTimeoutMinutes`). A lost Workflow start is started again under the
  same ID; one that never ran any SQL is marked failed; one that started executing and whose
  Workflow ended is marked failed with `code: "outcome_unknown"` and `requiresInspection: true`.
  None is ever marked succeeded.
- **`requiresInspection: true`** (in the deployment's log): check the target database by hand.
  `SELECT version_number, revision, deployment_id, applied_at FROM "_dbcenter"."version";`
  shows what was applied last. If `deployment_id` is this execution's ID, its transaction
  committed: compare the database with the design (statements after `COMMIT`, such as
  `CREATE INDEX CONCURRENTLY`, may be missing; the log's `lastStep` shows how far it got).
  Otherwise the transaction was rolled back. Fix the database by hand, then start a new
  deployment from the app: its pre-checks refuse a database that doesn't match.
- **Orphaned R2 objects** (SQL whose deployment is gone from D1) aren't expected: a deployment's
  row is written before its objects, and a purge deletes the objects before the rows (an
  interrupted purge leaves rows without objects, which the next run finishes). If one turns up,
  check that no `deployments` row has its ID, then delete both keys, e.g.
  `vp exec wrangler r2 object delete <bucket>/deployments/<id>.sql --remote`.

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
