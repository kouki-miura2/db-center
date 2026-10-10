import { useRegisterSW } from 'virtual:pwa-register/vue'

// Updating the app (docs/spec.md "共通ルール > 画面 > アプリの更新"). The browser looks for a new
// service worker only when a page loads, and an app on a phone mostly comes back from the
// background without one, so it's also checked when the app comes to the front and every hour.
// A new version waits for the person to tap "更新" (a form may be half filled in).

const CHECK_INTERVAL_MS = 60 * 60 * 1000

/** Called once, from `App.vue`. Off in `vp dev` (no service worker there). */
export const usePwaUpdate = () => {
  const { needRefresh, updateServiceWorker } = useRegisterSW({
    onRegisteredSW: (_url, registration) => {
      if (!registration) return
      // Rejects offline; the next check tries again.
      const check = () => void registration.update().catch(() => {})
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check()
      })
      setInterval(check, CHECK_INTERVAL_MS)
    },
  })

  /** Hands over to the new version; the page reloads once it has taken over. */
  const update = () => void updateServiceWorker()

  return { needRefresh, update }
}
