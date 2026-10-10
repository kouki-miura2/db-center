---
name: check-secrets
description: Scan for leaked GitHub/Cloudflare/Google credentials (API keys, tokens, client secrets, service account keys) and private keys before a git commit/push or a deploy. Use before committing, before pushing to GitHub, before `wrangler deploy` or shipping a Node.js build, or whenever asked to check for leaked secrets/credentials.
---

# Check for leaked secrets

Run this before anything that makes code more visible than it already is: a git commit, a push
to GitHub, or a deploy (a built frontend bundle is public the moment it's served). Covers GitHub,
Cloudflare, and Google specifically, plus generic credential shapes.

## Procedure

### 1. Decide the scope

- **Before a commit**: scan the staged diff (`git diff --cached`) and any new files being added.
- **Before a push**: scan every commit that hasn't been pushed yet
  (`git log -p origin/<branch>..HEAD`, or `git log -p --all` for a first push to a new remote).
- **Before a deploy**: scan what's about to go live.
  - Cloudflare Workers (`apps/backend-worker`): `wrangler.jsonc` (especially `vars` and binding
    blocks) and the bundle in `apps/backend-worker/dist` (`vp run -t backend-worker#build`).
  - Node.js (`apps/backend-node`): the bundle in `apps/backend-node/dist`.
  - Frontend: `apps/frontend/dist/**/*.{js,html}`. Every `VITE_*` value is inlined into the
    bundle and publicly downloadable — never rely on "it's just a build artifact" to keep it private.

### 2. Grep for provider-specific credential shapes

```bash
# Google: API keys, OAuth client secrets, service account keys
grep -rniE "AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]+|\"type\":\s*\"service_account\"" <scope>

# GitHub: personal access tokens, fine-grained PATs, OAuth/App/server-to-server tokens
grep -rniE "ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|gh[ousr]_[A-Za-z0-9]{20,}" <scope>

# Cloudflare: no fixed token prefix, so check by variable name instead
grep -rniE "CLOUDFLARE_API_TOKEN|CF_API_TOKEN|cloudflare.{0,20}(api.?key|global.?key)" <scope>

# Generic: private key blocks, and `xxx_key = "long-value"`-shaped assignments
grep -rniE "\-\-\-\-\-BEGIN (RSA|EC|OPENSSH|PGP|PRIVATE) KEY\-\-\-\-\-" <scope>
grep -rniE "(api|access|secret)[_-]?(key|token)[[:space:]]*[:=][[:space:]]*['\"][A-Za-z0-9_/+.-]{20,}" <scope>
```

Replace `<scope>` with the actual target: a directory (`apps/frontend/dist`), or pipe from
`git diff --cached` / `git log -p ...` instead of grepping files directly.

### 3. Check for secret-shaped files

```bash
git ls-files | grep -iE "\.env(\..*)?$|dev\.vars|credentials?\.|service.?account.*\.json|\.pem$|\.key$|\.p12$" \
  | grep -vxE "apps/frontend/\.env|(.*/)?\.env\.example"
```

Anything listed should not be tracked. `.env`, `.env.*`, and `.dev.vars` must be gitignored —
confirm with `git check-ignore -v <path>` if unsure.

Two tracked env files are intentional and excluded above, but still check their contents:

- `apps/frontend/.env` — tracked on purpose; holds only public, non-secret values (e.g.
  `VITE_APP_TITLE`). Since every `VITE_*` value ends up in the public bundle anyway, anything
  secret added here is a leak — run step 2 against it.
- `.env.example` files — placeholders only, never real values.

### 4. Check Cloudflare-specific config

`apps/backend-worker/wrangler.jsonc` is committed, and its `vars` are readable by anyone with
access to the Worker once deployed — so `vars` may only ever hold values that are safe to be
fully public. Anything actually secret must go through `wrangler secret put` (and locally
`.dev.vars`, gitignored), never `vars`. When in doubt about a specific value, ask: "would this
let someone impersonate the app or access an account if leaked?" — if yes, it must not be in
`vars` or committed anywhere. Environment-specific values that aren't secret (client IDs, resource
IDs, hostnames) don't belong in committed `vars` either: this project treats every repository as
public (see "Secrets and Environment-Specific Values" in the root `AGENTS.md`).

### 5. Report

- If nothing is found: say so plainly — don't just silently proceed, since the person asking
  wants to hear the check actually ran.
- If something is found: **do not commit/push/deploy**. Remove it from the file. If it was
  already committed (even unpushed), the commit must be amended/redone before proceeding — for an
  unpushed commit this is safe to do locally; for anything already pushed or already deployed,
  treat the credential as compromised and tell the user it needs to be rotated (a new Google
  client secret / GitHub token / Cloudflare API token issued and the old one revoked), since
  removing it from future commits doesn't undo the exposure — rewriting already-pushed history is
  itself a destructive operation, so confirm with the user before doing that part.

## Also flag account-specific identifiers

Flag the following and ask before letting them be committed or deployed, whether the repository
is public or private: this project treats every repository as if it were public, so production
resource IDs live in untracked configuration, never in tracked files. None of them grants access
by itself, but a clone or a later change of visibility would publish them:

- **Cloudflare Account ID** / **Zone ID**
- **D1 `database_id`**, **KV namespace `id`**, **R2 `bucket_name`**

These don't match a generic regex (an ID is just a hex string or UUID), so read the real values
fresh from the config the deploy uses (`wrangler.jsonc` or its untracked override) and
`npx wrangler whoami`, then grep `<scope>` for those literal values. Never write the actual values into this skill file.

## Not a secret, but flag it if hardcoded as a default in committed source

- **Google OAuth Client ID** (`NNNNNNNNNN-xxxx.apps.googleusercontent.com`) — not secret by design
  (it ships in client-side JS), so it's fine in an untracked env var or secret. What to
  catch is a real Client ID hardcoded as a fallback default in source (`value ?? 'real-id'`),
  which would make every fork/clone silently use the original author's Google Cloud project. Grep
  committed source for `apps.googleusercontent.com`; the fix is removing the default (require the
  env var), not rotation.
