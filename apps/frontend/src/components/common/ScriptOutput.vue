<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import { downloadFile } from '../../export/download.ts'
import { useNotificationStore } from '../../stores/notification.ts'

// A generated script (design 4l 4n, 6l): file name, line count, copy and download. On a phone it
// starts folded to its first lines ("全文を表示").
const props = defineProps<{ fileName: string; sql: string; targetLabel: string }>()
const { xs } = useDisplay()
const notification = useNotificationStore()
const expanded = ref(false)

const PREVIEW_LINES = 12
const lines = computed(() => props.sql.split('\n'))
const shown = computed(() =>
  xs.value && !expanded.value ? lines.value.slice(0, PREVIEW_LINES) : lines.value,
)

const copy = async () => {
  try {
    await navigator.clipboard.writeText(props.sql)
    notification.show('スクリプトをコピーしました')
  } catch {
    notification.show('コピーできませんでした。ダウンロードしてください')
  }
}
const download = () => downloadFile(props.fileName, props.sql, 'application/sql;charset=utf-8')
</script>

<template>
  <v-card class="script-output">
    <div class="d-flex align-center flex-wrap ga-2 px-4 py-3 border-b">
      <v-icon icon="mdi-file-code-outline" size="18" color="medium-emphasis" />
      <span class="font-mono text-body-2 text-truncate">{{ fileName }}</span>
      <span class="screen-caption font-mono">{{ lines.length.toLocaleString() }} 行</span>
      <v-chip>{{ targetLabel }}</v-chip>
      <v-spacer />
      <v-btn variant="outlined" size="small" prepend-icon="mdi-content-copy" @click="copy"
        >コピー</v-btn
      >
      <v-btn variant="outlined" size="small" prepend-icon="mdi-download" @click="download"
        >ダウンロード</v-btn
      >
    </div>
    <pre
      class="script-code font-mono"
    ><code><span v-for="(line, i) in shown" :key="i" class="script-line"><span class="script-number">{{ i + 1 }}</span>{{ line }}</span></code></pre>
    <div v-if="xs && lines.length > PREVIEW_LINES" class="pa-3 border-t text-center">
      <v-btn variant="text" size="small" @click="expanded = !expanded">{{
        expanded ? '折りたたむ' : '全文を表示'
      }}</v-btn>
    </div>
  </v-card>
</template>

<style scoped>
.script-code {
  margin: 0;
  padding: 12px 0;
  max-height: 560px;
  overflow: auto;
  font-size: 12px;
  line-height: 1.6;
  background: #fafafb;
}

.script-line {
  display: block;
  padding-right: 16px;
  white-space: pre;
}

.script-number {
  display: inline-block;
  width: 3.5em;
  padding-right: 12px;
  text-align: right;
  color: #9aa0ab;
  user-select: none;
}
</style>
