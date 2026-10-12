import { type Ref, onScopeDispose } from 'vue'
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router'

export const useUnsavedChanges = (dirty: Ref<boolean>) => {
  onBeforeRouteLeave(
    () => !dirty.value || window.confirm('未保存の変更があります。画面を離れますか？'),
  )
  const prevent = (event: BeforeUnloadEvent) => {
    if (!dirty.value) return
    event.preventDefault()
    event.returnValue = ''
  }
  onBeforeRouteUpdate(
    (to, from) =>
      to.path === from.path ||
      !dirty.value ||
      window.confirm('未保存の変更があります。画面を離れますか？'),
  )
  window.addEventListener('beforeunload', prevent)
  onScopeDispose(() => window.removeEventListener('beforeunload', prevent))
}
