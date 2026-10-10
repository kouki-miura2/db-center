# Public app conventions

Conventions for an app offered to the public: Sign in with Google, terms of service and a privacy policy, the operator's details, and consent on sign-up. Record the chosen behavior in `docs/spec.md` ("共通ルール > 同意") when it exists.

## Config values

Add these as in "Public config values for the frontend" in the root `AGENTS.md`:

```
# VITE_GOOGLE_WEB_CLIENT_ID=<web OAuth client id>
# VITE_OPERATOR_NAME=<operator name shown in the terms and privacy policy>
# VITE_CONTACT_EMAIL=<contact email shown in the terms and privacy policy>
```

The backend also needs the client ID, as a secret; list both places in `README.md`.

## Sign in with Google

- The official Google button (Google Identity Services) can't be disabled, so it can't wait for a consent checkbox: consent comes after the sign-in (see below).
- The API verifies the ID token, with the client ID as its `aud`.
- Only when `VITE_GOOGLE_WEB_CLIENT_ID` is unset, show a disabled `v-btn` that looks like the official button in its place: `size: large`, `shape: pill`, 40px high, at most 400px wide. A development login may stand in for Google (see "Auth" in the root `AGENTS.md`).

## Terms of service and privacy policy

- Embed the operator's name and contact email (e.g. in `apps/frontend/src/legal/documents.ts`) instead of writing them into the text:
  ```ts
  const OPERATOR = import.meta.env.VITE_OPERATOR_NAME || '（運営者名）'
  const CONTACT = import.meta.env.VITE_CONTACT_EMAIL || '（お問い合わせ先）'
  ```
- The text is a draft the operator checks for legal issues themselves; don't present it as legally reviewed.

## Consent on sign-up

1. The welcome screen shows the official Google button.
2. After the API verifies the ID token, a registered user whose agreed terms version is current goes straight to the home screen.
3. An unregistered user gets the consent screen: links to the terms of service and privacy policy, and a consent checkbox. The button that starts using the app (e.g. "同意してはじめる") stays disabled until it's ticked.
4. After consent, call the registration API with the ID token and the terms version agreed to. The user is created only then, so consent is recorded on the server.

Links from the consent screen to the terms open in a new tab: the same tab would lose the signed-in state (the ID token).
