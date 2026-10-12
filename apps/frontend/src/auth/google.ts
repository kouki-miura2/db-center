// Sign in with Google through Google Identity Services: the official button, rendered by Google
// (`docs/agents/public-app.md`). Its script is loaded only on the sign-in screen.

interface GoogleIdentity {
  accounts: {
    id: {
      initialize: (options: {
        client_id: string
        callback: (response: { credential: string }) => void
      }) => void
      renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void
    }
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client'

let loading: Promise<GoogleIdentity> | null = null

/** Loads the Google Identity Services script once (again after a failure). */
export const loadGoogleIdentity = () =>
  (loading ??= new Promise<GoogleIdentity>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = SCRIPT_URL
    script.async = true
    script.onload = () => (window.google ? resolve(window.google) : reject(new Error('no gsi')))
    script.onerror = () => {
      loading = null
      script.remove()
      reject(new Error('gsi failed to load'))
    }
    document.head.append(script)
  }))

/** Renders the official button into `parent`; `onCredential` receives the ID token. */
export const renderGoogleButton = async (
  parent: HTMLElement,
  clientId: string,
  onCredential: (idToken: string) => void,
) => {
  const google = await loadGoogleIdentity()
  google.accounts.id.initialize({
    client_id: clientId,
    callback: ({ credential }) => onCredential(credential),
  })
  google.accounts.id.renderButton(parent, {
    type: 'standard',
    theme: 'outline',
    size: 'large',
    shape: 'pill',
    text: 'signin_with',
    locale: 'ja',
    width: Math.min(parent.clientWidth || 380, 400),
  })
}
