import { readonly, ref } from 'vue'

// Whether the device is online ("共通ルール > オフライン"): offline, the last data shows read-only
// and every change, output, build and migration is unavailable. One state for the whole app.
const online = ref(typeof navigator === 'undefined' || navigator.onLine)
let listening = false

export const useOnline = () => {
  if (!listening && typeof window !== 'undefined') {
    listening = true
    window.addEventListener('online', () => (online.value = true))
    window.addEventListener('offline', () => (online.value = false))
  }
  return readonly(online)
}
