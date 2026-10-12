<script setup lang="ts">
import type { Target } from 'utils'
import { computed, reactive, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useDefinitionExport } from '../../composables/useDefinitionExport.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useVersionQuery } from '../../composables/useVersionQuery.ts'
import { definitionBlocks } from '../../export/definition.ts'
import { downloadFile } from '../../export/download.ts'
import { definitionMarkdown } from '../../export/markdown.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import OperationError from '../common/OperationError.vue'

// The table definition (design 4k 5k 6k): any version as PDF or Markdown, all schemas or some,
// the chosen contents, marks against another version, and the paper (PDF only). Made in the
// browser and downloaded; nothing is stored ("各論 > データベース > テーブル定義書").
type Version = DatabaseData['versions'][number]
const props = defineProps<{
  productId: string
  databaseId: string
  databaseName: string
  target: Target
  version: Version
  versions: Version[]
}>()
const open = defineModel<boolean>({ required: true })
const { xs } = useDisplay()
const online = useOnline()
const notification = useNotificationStore()
const exporter = useDefinitionExport()

const STATUS = { editing: '編集中', provisional: '仮確定', final: '確定' } as const
const versionTitle = (v: Version) => `v${v.number} ・ ${STATUS[v.status]}`

const form = reactive({
  versionId: props.version.id,
  format: 'pdf' as 'pdf' | 'markdown',
  allSchemas: true,
  schemaKeys: [] as string[],
  coverHistory: true,
  tableList: true,
  columns: true,
  constraintsIndexes: true,
  size: true,
  viewsSequences: true,
  ddl: false,
  revisions: true,
  orientation: 'landscape' as 'landscape' | 'portrait',
})
const selected = computed(
  () => props.versions.find((v) => v.id === form.versionId) ?? props.version,
)
/** Compared by default with the version it was made from, else the previous final one. */
const compareCandidates = computed(() => props.versions.filter((v) => v.id !== selected.value.id))
const compareId = ref<string | null>(null)
watch(
  selected,
  (v) => {
    compareId.value =
      v.sourceVersionId ??
      props.versions.find((o) => o.status === 'final' && o.number < v.number)?.id ??
      null
    form.revisions = compareId.value !== null
  },
  { immediate: true },
)
const fileName = ref('')
watch(
  () => [selected.value.number, form.format] as const,
  ([number]) => {
    fileName.value = `${props.databaseName}_v${number}_テーブル定義書`
  },
  { immediate: true },
)

// The schemas of the chosen version, for "選んだスキーマ" (SQLite 3 has none).
const design = useVersionQuery(() => (form.allSchemas ? '' : form.versionId))
const schemas = computed(() =>
  (design.data.value?.data.objects ?? [])
    .filter((o) => o.kind === 'schema')
    .map((o) => ({ title: o.name, value: o.objectKey })),
)

const pages = ref<number>()
const lastPdf = ref<Blob>()
const ddlError = ref<string>()
const pending = ref(false)
const failure = ref<unknown>()
const valid = computed(
  () =>
    !!fileName.value.trim() &&
    (form.allSchemas || form.schemaKeys.length > 0) &&
    (!form.revisions || compareId.value !== null || compareCandidates.value.length === 0),
)

const generate = async () => {
  if (!valid.value) return
  pending.value = true
  failure.value = undefined
  ddlError.value = undefined
  try {
    const data = await exporter.mutateAsync({
      versionId: form.versionId,
      json: {
        ...(form.allSchemas || props.target === 'sqlite3' ? {} : { schemaKeys: form.schemaKeys }),
        sections: {
          cover: form.coverHistory,
          history: form.coverHistory,
          tableList: form.tableList,
          columns: form.columns,
          constraints: form.constraintsIndexes,
          indexes: form.constraintsIndexes,
          size: form.size,
          viewsSequences: form.viewsSequences,
          ddl: form.ddl,
          revisions: form.revisions && compareId.value !== null,
        },
        compareVersionId: form.revisions ? compareId.value : null,
      },
    })
    if (data.ddl?.status === 'error') ddlError.value = data.ddl.error.message
    const blocks = definitionBlocks(data, new Date())
    const name = fileName.value.trim()
    if (form.format === 'markdown') {
      downloadFile(
        `${name}.md`,
        definitionMarkdown(blocks, data.metadata.draft),
        'text/markdown;charset=utf-8',
      )
    } else {
      const { definitionPdf } = await import('../../export/pdf.ts')
      const pdf = await definitionPdf(blocks, {
        orientation: form.orientation,
        draft: data.metadata.draft,
      })
      pages.value = pdf.pages
      lastPdf.value = pdf.blob
      downloadFile(`${name}.pdf`, pdf.blob, 'application/pdf')
    }
    notification.show('テーブル定義書を出力しました')
  } catch (error) {
    failure.value = error
  } finally {
    pending.value = false
  }
}

const preview = () => {
  if (!lastPdf.value) return
  const url = URL.createObjectURL(lastPdf.value)
  window.open(url, '_blank', 'noopener')
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
</script>

<template>
  <v-dialog
    v-model="open"
    :persistent="pending"
    :max-width="xs ? '100%' : 560"
    :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
    scrollable
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <v-card-title>テーブル定義書を出力</v-card-title>
      <v-card-text>
        <OperationError :error="failure" @reload="generate" />
        <v-alert
          v-if="ddlError"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          :text="`付録の DDL を生成できなかったため、DDL を除いて出力しました: ${ddlError}`"
        />
        <v-select
          v-model="form.versionId"
          label="バージョン"
          :items="versions"
          :item-title="versionTitle"
          item-value="id"
          class="mb-2"
          :hint="
            selected.status === 'editing'
              ? '編集中のバージョンは「ドラフト」の透かし入りで出力されます'
              : undefined
          "
          persistent-hint
        />
        <v-btn-toggle
          v-model="form.format"
          mandatory
          variant="outlined"
          density="comfortable"
          divided
          class="mb-4"
        >
          <v-btn value="pdf" prepend-icon="mdi-file-pdf-box">PDF</v-btn>
          <v-btn value="markdown" prepend-icon="mdi-language-markdown-outline">Markdown</v-btn>
        </v-btn-toggle>
        <template v-if="target === 'postgresql18'">
          <v-radio-group v-model="form.allSchemas" inline hide-details label="出力範囲">
            <v-radio :value="true" label="すべてのスキーマ" />
            <v-radio :value="false" label="選んだスキーマ" />
          </v-radio-group>
          <v-select
            v-if="!form.allSchemas"
            v-model="form.schemaKeys"
            :items="schemas"
            :loading="design.isPending.value"
            label="スキーマ"
            multiple
            chips
            class="mt-2"
            hint="選んだスキーマの外を参照する DDL（付録）は、範囲を広げるか DDL を除いて出力してください"
            persistent-hint
          />
        </template>
        <h3 class="mt-4 mb-1">出力内容</h3>
        <v-checkbox v-model="form.coverHistory" label="表紙・改訂履歴" hide-details />
        <v-checkbox v-model="form.tableList" label="テーブル一覧" hide-details />
        <v-checkbox v-model="form.columns" label="カラム定義" hide-details />
        <v-checkbox v-model="form.constraintsIndexes" label="制約・インデックス" hide-details />
        <v-checkbox v-model="form.size" label="サイズ設計" hide-details />
        <v-checkbox v-model="form.viewsSequences" label="ビュー・シーケンス" hide-details />
        <v-checkbox v-model="form.ddl" label="DDL（付録）" hide-details />
        <div class="d-flex align-center ga-3 flex-wrap">
          <v-checkbox
            v-model="form.revisions"
            label="改訂箇所に印"
            hide-details
            :disabled="compareCandidates.length === 0"
          />
          <v-select
            v-if="form.revisions && compareCandidates.length"
            v-model="compareId"
            :items="compareCandidates"
            :item-title="(v: Version) => `${versionTitle(v)} と比較`"
            item-value="id"
            density="compact"
            hide-details
            style="max-width: 240px"
          />
        </div>
        <template v-if="form.format === 'pdf'">
          <h3 class="mt-4 mb-1">用紙</h3>
          <v-btn-toggle
            v-model="form.orientation"
            mandatory
            variant="outlined"
            density="comfortable"
            divided
          >
            <v-btn value="landscape">A4 横</v-btn>
            <v-btn value="portrait">A4 縦</v-btn>
          </v-btn-toggle>
        </template>
        <v-text-field
          v-model="fileName"
          label="ファイル名"
          class="mt-4"
          :suffix="form.format === 'pdf' ? '.pdf' : '.md'"
          hide-details="auto"
        />
        <p v-if="pages && form.format === 'pdf'" class="screen-caption mt-2">
          前回の出力: 全 {{ pages }} ページ
        </p>
      </v-card-text>
      <v-card-actions>
        <v-btn
          v-if="lastPdf && form.format === 'pdf'"
          variant="text"
          prepend-icon="mdi-eye-outline"
          @click="preview"
          >プレビュー</v-btn
        >
        <v-spacer />
        <v-btn variant="text" :disabled="pending" @click="open = false">キャンセル</v-btn>
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-download"
          :loading="pending"
          :disabled="!online || !valid"
          @click="generate"
          >{{ form.format === 'pdf' ? 'PDFを出力' : 'Markdownを出力' }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
