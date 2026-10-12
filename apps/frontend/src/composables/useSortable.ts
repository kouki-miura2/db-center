import Sortable from 'sortablejs'
import { type Ref, onScopeDispose, watch } from 'vue'

/** Native drag handles, with a short touch hold; keyboard buttons remain available alongside. */
export const useSortable = <T>(
  element: Ref<HTMLElement | undefined>,
  items: Ref<T[]>,
  disabled: Ref<boolean>,
) => {
  let sortable: Sortable | undefined
  watch(
    element,
    (el) => {
      sortable?.destroy()
      if (!el) return
      sortable = Sortable.create(el, {
        handle: '.drag-handle',
        draggable: '[data-sortable]',
        animation: 150,
        delay: 200,
        delayOnTouchOnly: true,
        disabled: disabled.value,
        onEnd: ({ oldIndex, newIndex }) => {
          if (oldIndex === undefined || newIndex === undefined || oldIndex === newIndex) return
          // Restore Vue's DOM before updating its keyed array.
          const moved = el.children[newIndex]
          if (moved) {
            el.removeChild(moved)
            el.insertBefore(moved, el.children[oldIndex] ?? null)
          }
          const next = [...items.value]
          const [item] = next.splice(oldIndex, 1)
          if (item !== undefined) next.splice(newIndex, 0, item)
          items.value = next
        },
      })
    },
    { flush: 'post' },
  )
  watch(disabled, (value) => sortable?.option('disabled', value))
  onScopeDispose(() => sortable?.destroy())
}
