<script setup lang="ts">
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { sql, PostgreSQL, SQLite } from '@codemirror/lang-sql'
import { syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { EditorState, Compartment } from '@codemirror/state'
import { EditorView, lineNumbers, keymap, highlightActiveLine } from '@codemirror/view'
import type { Target } from 'utils'
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
const props = defineProps<{ target: Target; disabled: boolean }>()
const model = defineModel<string>({ required: true })
const element = ref<HTMLElement>()
const editable = new Compartment()
let editor: EditorView | undefined
onMounted(() => {
  editor = new EditorView({
    parent: element.value,
    state: EditorState.create({
      doc: model.value,
      extensions: [
        lineNumbers(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle),
        sql({ dialect: props.target === 'sqlite3' ? SQLite : PostgreSQL }),
        EditorView.lineWrapping,
        editable.of([
          EditorState.readOnly.of(props.disabled),
          EditorView.editable.of(!props.disabled),
        ]),
        EditorView.contentAttributes.of({
          'aria-label': '定義（SELECT）',
          role: 'textbox',
          'aria-multiline': 'true',
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) model.value = update.state.doc.toString()
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: "'Noto Sans JP', sans-serif", overflow: 'auto' },
          '.cm-content': { padding: '16px 0' },
          '.cm-gutters': { backgroundColor: '#fafbfc', border: 'none', color: '#a1aaba' },
        }),
      ],
    }),
  })
})
watch(model, (value) => {
  if (editor && value !== editor.state.doc.toString())
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } })
})
watch(
  () => props.disabled,
  (value) =>
    editor?.dispatch({
      effects: editable.reconfigure([
        EditorState.readOnly.of(value),
        EditorView.editable.of(!value),
      ]),
    }),
)
onBeforeUnmount(() => editor?.destroy())
</script>
<template><div ref="element" class="sql-editor" /></template>
