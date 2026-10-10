# packages/utils

- Runtime-agnostic code shared by `apps/backend` and `apps/frontend`: web-standard APIs only (no Node.js or browser-only APIs), since it runs in the browser, on Cloudflare Workers and on Node.js.
- Limits (`src/limits/limits.ts`): every cap, size, duration and count the app enforces or depends on is an entry in `LIMITS`, never a literal in app code. It mirrors the `docs/spec.md` "参照 > リミット値" table one-to-one — adding, removing or changing a value means changing both in the same change. Both the UI and the API import the same entry, so their checks can't drift apart. Follow the naming/JSDoc conventions in the file's header comment.
- Date/time (`src/date/`): every helper works in the app's time zone (`TIME_ZONE_OFFSET_MINUTES` in `src/date/zone.ts`, which must match the spec's "総論 > 提供形態"), never the runtime's local time zone, so the browser and the server (UTC on Cloudflare Workers) agree on "today", weeks and months. App code uses these helpers instead of `Date`'s local-time getters (`getDate()`, `toLocaleDateString()`, ...).
- Text (`src/text/`): character-count limits (`LIMITS.*MaxLength`) are counted with `charLength` (one per visible character), never `String.prototype.length`.
- Logger: a thin wrapper over `console.*` (log levels, prefixing, env-aware). Application code calls the logger, never `console.log` directly.
