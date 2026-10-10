# utils

Shared runtime utilities used by `apps/backend` and `apps/frontend`.

- `limits` — `LIMITS`, the app's limits and tunable values in one place, mirroring the `docs/spec.md` "リミット値" table.
- `date` — formatting (`formatDate`) and calculation (`addDays`, `addMonths`, `addYears`, `startOfDay`, `endOfDay`, `startOfWeek`, `startOfMonth`, `isSameDay`, `diffInDays`) helpers, built on the native `Date` API only. All of them work in the app's time zone (`TIME_ZONE_OFFSET_MINUTES`, default JST), not the runtime's local one.
- `text` — `charLength` / `truncateChars`, counting one per visible character (grapheme cluster) for character-count limits.
- `logger` — `createLogger()`, a thin wrapper over `console.*` with level filtering and an optional prefix.

Consumed directly from source (`apps/backend`, `apps/frontend` resolve `utils` to `src/index.ts`) — no build step needed.

## Development

- Run the unit tests:

```bash
vp test
```
