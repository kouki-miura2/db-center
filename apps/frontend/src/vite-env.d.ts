/// <reference types="vite/client" />

// Public, per-environment values (root `AGENTS.md` "Public config values for the frontend"):
// optional, falling back with `||` when unset or empty.
interface ImportMetaEnv {
  readonly VITE_APP_TITLE: string
  /** Google sign-in; unset shows a disabled stand-in button (`docs/agents/public-app.md`). */
  readonly VITE_GOOGLE_WEB_CLIENT_ID?: string
  /** The operator shown in the terms of service and privacy policy. */
  readonly VITE_OPERATOR_NAME?: string
  /** The contact email shown in the terms of service and privacy policy. */
  readonly VITE_CONTACT_EMAIL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
