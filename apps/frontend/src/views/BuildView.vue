<script setup lang="ts">
import { TARGETS, type Target } from 'utils'
import { reactive, ref } from 'vue'

import OperationError from '../components/common/OperationError.vue'
import ScriptOutput from '../components/common/ScriptOutput.vue'
import DatabasePage from '../components/database/DatabasePage.vue'
import type { DatabaseData } from '../composables/useDatabaseQuery.ts'
import { useOnline } from '../composables/useOnline.ts'
import { type DdlOptions, useDdlScript } from '../composables/useScriptMutations.ts'

// Build (design 4l 5l 6l): the DDL script of a provisional or final version, with the options of
// "ビルド・マイグレーション > 出力" that apply to the target. Copied or downloaded, never stored.
defineProps<{ productId: string; databaseId: string }>()
const online = useOnline()
const ddl = useDdlScript()
const versionId = ref<string>()
const options = reactive<Required<DdlOptions>>({
  includeSchemas: true,
  includeComments: true,
  transaction: true,
  ifNotExists: false,
  versionTable: true,
  dropExisting: false,
})

/** The options of each target: SQLite 3 has no schemas, and no COMMENT ON. */
const optionLabels = (target: Target) =>
  (
    [
      ['includeSchemas', 'CREATE SCHEMA を含める', true],
      ['includeComments', 'COMMENT ON を含める（論理名・コメント）', true],
      ['transaction', 'トランザクション（BEGIN / COMMIT）で囲む', false],
      ['ifNotExists', 'IF NOT EXISTS を付与', false],
      ['versionTable', '適用バージョン管理テーブルを作成', false],
      ['dropExisting', '既存オブジェクトを削除してから作成（DROP ... CASCADE）', false],
    ] as const
  )
    .filter(([, , postgresOnly]) => target === 'postgresql18' || !postgresOnly)
    .map(([key, label]) => ({ key, label }))

const outputVersions = (database: DatabaseData) =>
  database.versions.filter((v) => v.status !== 'editing')
const versionTitle = (v: DatabaseData['versions'][number]) =>
  `v${v.number} ・ ${v.status === 'final' ? '確定' : '仮確定'}`

const generate = (database: DatabaseData) => {
  const id = versionId.value ?? outputVersions(database)[0]?.id
  if (!id) return
  versionId.value = id
  void ddl.mutateAsync({ versionId: id, options: { ...options } }).catch(() => {})
}
</script>

<template>
  <DatabasePage
    v-slot="{ database, product }"
    :product-id="productId"
    :database-id="databaseId"
    section="build"
  >
    <div class="screen-header">
      <h1 class="screen-title">データベースをビルド</h1>
    </div>
    <v-alert
      v-if="outputVersions(database).length === 0"
      type="info"
      variant="tonal"
      text="ビルドできるのは仮確定・確定のバージョンです。設計を仮確定してください。"
    />
    <div v-else class="build-layout">
      <v-card class="pa-5 build-settings">
        <v-select
          :model-value="versionId ?? outputVersions(database)[0]?.id"
          label="対象バージョン"
          :items="outputVersions(database)"
          :item-title="versionTitle"
          item-value="id"
          hint="仮確定・確定のバージョンのみ選択できます"
          persistent-hint
          class="mb-4"
          @update:model-value="versionId = $event"
        />
        <h3 class="mb-1">オプション</h3>
        <v-checkbox
          v-for="option in optionLabels(product.product.target)"
          :key="option.key"
          v-model="options[option.key]"
          :label="option.label"
          hide-details
        />
        <p class="screen-caption mt-3 d-flex ga-2">
          <v-icon icon="mdi-file-tree-outline" size="16" />
          依存関係の順に生成します：スキーマ → シーケンス → テーブル → 外部キー → インデックス →
          ビュー
        </p>
        <v-btn
          color="primary"
          block
          class="mt-4"
          prepend-icon="mdi-file-code-outline"
          :loading="ddl.isPending.value"
          :disabled="!online"
          @click="generate(database)"
          >DDLを出力</v-btn
        >
      </v-card>
      <div class="build-result">
        <OperationError :error="ddl.error.value" @reload="generate(database)" />
        <template v-if="ddl.data.value">
          <v-alert
            v-for="(warning, i) in ddl.data.value.warnings"
            :key="i"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-3"
            :text="warning"
          />
          <ScriptOutput
            :file-name="ddl.data.value.fileName"
            :sql="ddl.data.value.sql"
            :target-label="TARGETS[product.product.target].label"
          />
        </template>
        <v-card v-else-if="!ddl.error.value" class="pa-10 text-center screen-caption">
          対象バージョンとオプションを選んで「DDLを出力」を押してください
        </v-card>
      </div>
    </div>
  </DatabasePage>
</template>

<style scoped>
.build-layout {
  display: grid;
  grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

@media (max-width: 959.98px) {
  .build-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
