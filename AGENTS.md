# AGENTS.md

## Project Structure

Monorepo managed with pnpm workspaces (`apps/*`, `packages/*`). Project-specific conventions live in that project's own `AGENTS.md`, not here — read it before working in that folder. Where the two disagree, the project's own `AGENTS.md` wins inside that folder.

Not every repository has every entry below. Work with the ones that exist, and don't create a missing package just because it's listed here.

- `apps/backend` — API server (Hono): runtime-agnostic routes and business logic, no entrypoint. See `apps/backend/AGENTS.md`.
- `apps/backend-worker` — Runs `apps/backend` on Cloudflare Workers. See `apps/backend-worker/AGENTS.md`.
- `apps/frontend` — Web client (Vue 3 + Vuetify 4). See `apps/frontend/AGENTS.md`.
- `packages/utils` — Shared runtime utilities (e.g. date/time helpers, logger, app-wide limits, character counting). See `packages/utils/AGENTS.md`.
- `docs/spec.md` — App specification (features, permissions, limits, architecture, data model). When it exists, read it before implementing or changing behavior, and keep it in sync when the behavior changes.

## Conventions

- Co-location: `foo/bar.ts` + `foo/bar.test.ts`.
- Arrow functions everywhere (`const foo = (...) => {}`), no `function` declarations, including `packages/utils`.
- Favor less code: prefer a framework's built-in feature over a hand-rolled one, and add no abstraction, layer or shared package "just in case".
- Runtime packages (`apps/backend-*`) are thin entrypoints; routes and business logic go in `apps/backend`.
- One origin: the frontend at `/`, the API at `/api`. In development the frontend's Vite dev server proxies `/api` to the backend; in production the runtime package serves both.
- `apps/frontend` gets API request/response types from `apps/backend` via Hono RPC, not from a hand-written types package.
- Runtime-agnostic shared code goes in `packages/utils`, not duplicated per app.
- Auth: never deploy the placeholder `auth-guard.header.ts`. A development login, if any, works only in development: the frontend shows it only when `import.meta.env.DEV` is true, and the backend accepts it only when its runtime package enables it explicitly (never by default).

### Public config values for the frontend

Values that aren't secret but differ per environment (e.g. a VAPID public key) reach the frontend as build-time env vars (`import.meta.env.VITE_*`), not through an API (e.g. `GET /api/config`).

- Put them in `apps/frontend/.env.local` (gitignored). The committed `apps/frontend/.env` holds only values that are the same everywhere (e.g. `VITE_APP_TITLE`) and lists the others as commented-out names with a description:
  ```
  # VITE_VAPID_PUBLIC_KEY=<VAPID public key>   # only if Web Push is used
  ```
- Declare each in `ImportMetaEnv` (`apps/frontend/src/vite-env.d.ts`) as optional (`readonly VITE_X?: string`). Fall back with `||`, not `??`: an empty variable (`VITE_X=`) is `''`.
- Values only the backend uses (e.g. the VAPID private key) are secrets of the runtime package (see its `AGENTS.md`), never in committed config such as `wrangler.jsonc` `vars`.
- The app must still run when a value is unset, falling back to a placeholder or a disabled feature.
- When adding a value, list every place it must be set under the runtime package's deploy step in `README.md`.

## Secrets and Environment-Specific Values

These apply to every app built from this template, public or internal.

- Treat the repository as public, even when it's private: no credentials and no environment-specific values (e.g. client IDs, Cloudflare D1/KV/R2 IDs) in tracked files, not even to fix a failing build or deploy. Keep them in untracked configuration or the runtime's secret store.
- Anyone who can open the app can read the frontend build, `VITE_*` values included.
- Deploy only the build output. Never ship `.env*` files, `.dev.vars`, local databases, or source maps to a reachable location.

## Commit, Push, and Deployment Rules

These apply to every coding agent, not only Claude Code: follow each referenced file, where it exists, with the tools you have.

- Before committing, pushing, or deploying, read and follow `.claude/skills/check-secrets/SKILL.md`, including its account-specific identifier checks. Run the scan separately for each operation's scope.
- For commits and pushes, follow `.claude/agents/github-committer.md`. Where you can delegate to the `github-committer` agent, commit through it, and include in the task prompt the `Co-Authored-By:` trailer line from your own attribution instructions, verbatim, so the commit credits the model the user is working with rather than the subagent's.
- For Cloudflare deployments, follow `.claude/agents/cloudflare-deployer.md`.

## Optional Conventions

Read the matching file before working on the feature. If the file doesn't exist, the app doesn't use the feature — don't add it.

- Public app (Sign in with Google, terms of service, privacy policy, operator details, consent on sign-up): `docs/agents/public-app.md`.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
