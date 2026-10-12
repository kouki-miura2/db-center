<script setup lang="ts">
import { TARGETS, type Target } from 'utils'
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'

import OperationError from '../components/common/OperationError.vue'
import ScriptOutput from '../components/common/ScriptOutput.vue'
import DatabasePage from '../components/database/DatabasePage.vue'
import type { DatabaseData } from '../composables/useDatabaseQuery.ts'
import { useOnline } from '../composables/useOnline.ts'
import { type MigrationChange, useMigrationScript } from '../composables/useScriptMutations.ts'
import { useVersionQuery } from '../composables/useVersionQuery.ts'
import { changeSummary } from '../design/migration.ts'
import { fullName, kindLabels, toInput } from '../design/object.ts'

// Migration (design 4n 5n 6n): the update script from one provisional or final version to
// another, its differences with their risks (data loss, re-creation, outside the transaction)
// and the options of "ビルド・マイグレーション > 出力" that apply to the target.
const props = defineProps<{ productId: string; databaseId: string }>()
const route = useRoute()
const online = useOnline()
const migration = useMigrationScript(props.databaseId)
const picked = reactive<{ from?: string; to?: string }>({
  from: typeof route.query.from === 'string' ? route.query.from : undefined,
  to: typeof route.query.to === 'string' ? route.query.to : undefined,
})
const options = reactive({
  indexesConcurrently: true,
  constraintsNotValid: true,
  lockTimeout: true,
  lockTimeoutSeconds: 5,
  includeDrops: true,
})
const lockTimeoutError = computed(() =>
  options.lockTimeout &&
  !(Number.isInteger(options.lockTimeoutSeconds) && options.lockTimeoutSeconds > 0)
    ? '1以上の整数（秒）を入力してください'
    : null,
)

type Version = DatabaseData['versions'][number]
const outputVersions = (database: DatabaseData) =>
  database.versions.filter((v) => v.status !== 'editing')
const versionTitle = (v: Version) => `v${v.number} ・ ${v.status === 'final' ? '確定' : '仮確定'}`
/** The versions to compare: as picked, else the newest one and the final version before it. */
const pair = (database: DatabaseData) => {
  const list = outputVersions(database)
  const to = list.find((v) => v.id === picked.to) ?? list[0]
  const from =
    list.find((v) => v.id === picked.from) ??
    list.find((v) => v.status === 'final' && to && v.number < to.number) ??
    list.find((v) => to && v.number < to.number)
  return { from, to }
}

// Object names for the differences: the newer design first, then the older one (deletions).
const result = computed(() => migration.data.value)
const after = useVersionQuery(() => result.value?.toVersion.id ?? '')
const before = useVersionQuery(() => result.value?.fromVersion.id ?? '')
const nameOf = (change: MigrationChange) => {
  for (const scope of [after, before]) {
    const rows = scope.data.value?.data.objects ?? []
    const row = rows.find((o) => o.objectKey === change.objectKey)
    if (row) return fullName(toInput(row), rows)
  }
  return ''
}
const label = (change: MigrationChange) => {
  const object = nameOf(change)
  const part = changeSummary(change)
  return {
    name: part.name && change.entity !== 'object' ? `${object}.${part.name}` : object || part.name,
    description:
      change.entity === 'object'
        ? `${kindLabels[change.kind]}${part.description}`
        : part.description,
  }
}
const counts = computed(() => {
  const changes = result.value?.difference.changes ?? []
  return {
    dataLoss: changes.filter((c) => c.impact.dataLoss).length,
    recreation: changes.filter((c) => c.impact.recreation).length,
    outsideTransaction: changes.filter((c) => c.impact.outsideTransaction).length,
  }
})

const generate = (database: DatabaseData, target: Target) => {
  const { from, to } = pair(database)
  if (!from || !to || lockTimeoutError.value) return
  picked.from = from.id
  picked.to = to.id
  const postgres = target === 'postgresql18'
  void migration
    .mutateAsync({
      fromVersionId: from.id,
      toVersionId: to.id,
      options: {
        indexesConcurrently: postgres && options.indexesConcurrently,
        constraintsNotValid: postgres && options.constraintsNotValid,
        lockTimeoutMs: postgres && options.lockTimeout ? options.lockTimeoutSeconds * 1000 : null,
        includeDrops: options.includeDrops,
      },
    })
    .catch(() => {})
}
const signs = { added: '+', changed: '~', renamed: '~', deleted: '−' } as const
const signColors = {
  added: 'text-success',
  changed: 'text-warning',
  renamed: 'text-warning',
  deleted: 'text-error',
} as const
const expanded = ref(false)
</script>

<template>
  <DatabasePage
    v-slot="{ database, product }"
    :product-id="productId"
    :database-id="databaseId"
    section="migration"
  >
    <div class="screen-header">
      <h1 class="screen-title">マイグレーション</h1>
    </div>
    <v-alert
      v-if="outputVersions(database).length < 2"
      type="info"
      variant="tonal"
      text="差分スクリプトは、仮確定・確定のバージョンが2つ以上あると出力できます。"
    />
    <template v-else>
      <v-card class="pa-5 mb-4">
        <div class="migration-versions">
          <v-select
            :model-value="pair(database).from?.id"
            label="更新前"
            :items="outputVersions(database)"
            :item-title="versionTitle"
            item-value="id"
            hide-details
            @update:model-value="picked.from = $event"
          />
          <v-icon icon="mdi-arrow-right" class="migration-arrow" />
          <v-select
            :model-value="pair(database).to?.id"
            label="更新後"
            :items="outputVersions(database)"
            :item-title="versionTitle"
            item-value="id"
            hide-details
            @update:model-value="picked.to = $event"
          />
        </div>
        <h3 class="mt-4 mb-1">生成オプション</h3>
        <template v-if="product.product.target === 'postgresql18'">
          <v-checkbox
            v-model="options.indexesConcurrently"
            label="インデックスは CONCURRENTLY で作成"
            hide-details
          />
          <v-checkbox
            v-model="options.constraintsNotValid"
            label="制約は NOT VALID で追加し、VALIDATE で検証を分離"
            hide-details
          />
          <div class="d-flex align-center ga-3 flex-wrap">
            <v-checkbox v-model="options.lockTimeout" label="lock_timeout を設定" hide-details />
            <v-text-field
              v-if="options.lockTimeout"
              v-model.number="options.lockTimeoutSeconds"
              type="number"
              min="1"
              suffix="秒"
              density="compact"
              style="max-width: 140px"
              :error-messages="lockTimeoutError ?? undefined"
              hide-details="auto"
            />
          </div>
        </template>
        <v-checkbox v-model="options.includeDrops" label="削除（DROP）を含める" hide-details />
        <v-btn
          color="primary"
          class="mt-4"
          prepend-icon="mdi-file-code-outline"
          :loading="migration.isPending.value"
          :disabled="
            !online ||
            !pair(database).from ||
            !pair(database).to ||
            pair(database).from?.id === pair(database).to?.id ||
            !!lockTimeoutError
          "
          @click="generate(database, product.product.target)"
          >更新用DDLを出力</v-btn
        >
      </v-card>
      <OperationError
        :error="migration.error.value"
        @reload="generate(database, product.product.target)"
      />
      <template v-if="result">
        <v-card class="mb-4">
          <div class="d-flex align-center flex-wrap ga-3 px-4 py-3 border-b">
            <h3>差分 {{ result.difference.changes.length }}件</h3>
            <v-chip v-if="counts.dataLoss" color="error">データ損失 {{ counts.dataLoss }}</v-chip>
            <v-chip v-if="counts.recreation" color="warning">再作成 {{ counts.recreation }}</v-chip>
            <v-chip v-if="counts.outsideTransaction" color="info"
              >トランザクション外 {{ counts.outsideTransaction }}</v-chip
            >
          </div>
          <p v-if="result.difference.changes.length === 0" class="pa-4 screen-caption">
            v{{ result.fromVersion.number }} と v{{ result.toVersion.number }}
            の設計に差分はありません。
          </p>
          <v-list v-else density="compact">
            <v-list-item
              v-for="(change, i) in expanded
                ? result.difference.changes
                : result.difference.changes.slice(0, 20)"
              :key="i"
              :class="{ 'bg-red-lighten-5': change.impact.dataLoss }"
            >
              <div class="d-flex align-center ga-3 flex-wrap">
                <strong :class="['font-mono', signColors[change.action]]">{{
                  signs[change.action]
                }}</strong>
                <span class="font-mono text-body-2">{{ label(change).name }}</span>
                <span class="text-body-2 text-medium-emphasis">{{
                  label(change).description
                }}</span>
                <v-spacer />
                <v-chip v-if="change.impact.dataLoss" color="error">データ損失</v-chip>
                <v-chip v-if="change.impact.recreation" color="warning">再作成</v-chip>
                <v-chip v-if="change.impact.outsideTransaction" color="info"
                  >トランザクション外</v-chip
                >
              </div>
            </v-list-item>
          </v-list>
          <div v-if="result.difference.changes.length > 20" class="pa-2 border-t text-center">
            <v-btn variant="text" size="small" @click="expanded = !expanded">{{
              expanded ? '折りたたむ' : `すべて表示（${result.difference.changes.length}件）`
            }}</v-btn>
          </div>
        </v-card>
        <v-alert
          v-if="!result.complete"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          text="削除（DROP）を含めていないため、適用後のデータベースは更新後の設計と一致しない可能性があります。この出力では適用済みバージョンを進めません。"
        />
        <v-alert
          v-for="(warning, i) in result.warnings"
          :key="i"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
          :text="warning"
        />
        <ScriptOutput
          :file-name="result.fileName"
          :sql="result.sql"
          :target-label="TARGETS[product.product.target].label"
        />
      </template>
    </template>
  </DatabasePage>
</template>

<style scoped>
.migration-versions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 12px;
}

@media (max-width: 599.98px) {
  .migration-versions {
    grid-template-columns: minmax(0, 1fr);
  }

  .migration-arrow {
    transform: rotate(90deg);
    justify-self: center;
  }
}
</style>
