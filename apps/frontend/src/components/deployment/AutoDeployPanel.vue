<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import {
  type DeploymentPreviewInput,
  mayRetrySame,
  reasonText,
  useDeploymentPreview,
  useDeploymentStart,
} from '../../composables/useDeployments.ts'
import { useOnline } from '../../composables/useOnline.ts'
import type { ProductData } from '../../composables/useProductQuery.ts'
import OperationError from '../common/OperationError.vue'
import DeploymentProgress from './DeploymentProgress.vue'

// Automatic build or migration on a connection (design 4m 4o): the checks against it right now
// (empty / applied version, drift, data loss), then the run, which goes on asynchronously
// ("ビルド・マイグレーション > 自動ビルド・自動マイグレーション"). One run per connection at a time.
const props = defineProps<{
  productId: string
  databaseId: string
  kind: 'build' | 'migration'
  connections: ProductData['connections']
  versions: DatabaseData['versions']
  deployments: DatabaseData['deployments']
  toVersionId: string | undefined
  fromVersionId?: string
  migrationOptions?: DeploymentPreviewInput['migrationOptions']
}>()
const online = useOnline()
const preview = useDeploymentPreview()
const start = useDeploymentStart(props.databaseId)
const connectionId = ref(props.connections[0]?.id)
const confirming = ref(false)
const startedId = ref<string>()

const toVersion = computed(() => props.versions.find((v) => v.id === props.toVersionId))
const fromVersion = computed(() => props.versions.find((v) => v.id === props.fromVersionId))
const connection = computed(() => props.connections.find((c) => c.id === connectionId.value))
const request = computed((): DeploymentPreviewInput | null =>
  toVersion.value
    ? {
        kind: props.kind,
        toVersionId: toVersion.value.id,
        expectedRevision: toVersion.value.revision,
        ...(props.kind === 'migration'
          ? { fromVersionId: props.fromVersionId, migrationOptions: props.migrationOptions }
          : {}),
      }
    : null,
)
/** A run still going on the chosen connection: shown instead of a new one. */
const running = computed(() =>
  props.deployments.find((d) => d.connectionId === connectionId.value && d.status === 'running'),
)
const shownId = computed(() => startedId.value ?? running.value?.id)

// One key per request: sent again as is when the answer was lost, new when anything changes.
const idempotencyKey = ref(crypto.randomUUID())
watch(
  () => JSON.stringify([connectionId.value, request.value]),
  () => {
    idempotencyKey.value = crypto.randomUUID()
    preview.reset()
    start.reset()
    startedId.value = undefined
  },
)

const check = () => {
  if (!connectionId.value || !request.value) return
  void preview
    .mutateAsync({ connectionId: connectionId.value, json: request.value })
    .catch(() => {})
}

const run = async () => {
  if (!connectionId.value || !request.value) return
  confirming.value = false
  const row = await start
    .mutateAsync({
      connectionId: connectionId.value,
      json: { ...request.value, idempotencyKey: idempotencyKey.value },
    })
    .catch((error: unknown) => {
      // Without an answer it may have been accepted: keep the key so a retry finds it.
      if (!mayRetrySame(error)) idempotencyKey.value = crypto.randomUUID()
      return undefined
    })
  if (!row) return
  startedId.value = row.id
  idempotencyKey.value = crypto.randomUUID()
}

const postgresVersion = (version: number) => `${Math.floor(version / 10000)}.${version % 10000}`
const result = computed(() => preview.data.value)
const checks = computed(() => {
  const r = result.value
  if (!r) return []
  const rows = [
    {
      ok: r.inspection.supported,
      label: '接続',
      value: `PostgreSQL ${postgresVersion(r.inspection.version)}`,
    },
  ]
  if (props.kind === 'build')
    rows.push({
      ok: r.inspection.empty,
      label: '接続先が空',
      value: r.inspection.applied
        ? `v${r.inspection.applied.versionNumber} 適用済み`
        : r.inspection.empty
          ? '空のDB'
          : 'オブジェクトあり',
    })
  else {
    rows.push({
      ok: !r.reasons.includes('applied_version_mismatch'),
      label: '適用済みバージョンが更新前と一致',
      value: r.inspection.applied ? `v${r.inspection.applied.versionNumber}` : '未適用',
    })
    rows.push({
      ok: !r.reasons.includes('drift_detected') && !r.reasons.includes('drift_unverifiable'),
      label: 'ドリフト（設計外の変更）なし',
      value: r.drift?.verifiable ? `${r.drift.count}件` : '確認できません',
    })
    rows.push({
      ok: !r.dataLoss,
      label: 'データ損失なし',
      value: r.dataLoss ? 'データ損失あり' : '',
    })
  }
  return rows
})
</script>

<template>
  <div>
    <v-alert
      v-if="connections.length === 0"
      type="info"
      variant="tonal"
      text="データベース接続情報がありません。プロダクト設定で接続情報を登録すると自動実行できます。"
    />
    <template v-else>
      <v-card class="pa-5 mb-4">
        <h3 class="mb-2">接続先</h3>
        <v-radio-group v-model="connectionId" hide-details>
          <v-radio v-for="c in connections" :key="c.id" :value="c.id">
            <template #label>
              <span class="d-flex flex-column">
                <span class="text-body-2 text-high-emphasis">{{ c.name }}</span>
                <span class="screen-caption font-mono">{{ c.connectionString }}</span>
              </span>
            </template>
          </v-radio>
        </v-radio-group>
        <p v-if="kind === 'build'" class="screen-caption mt-3">
          既存オブジェクトがある接続先には、マイグレーションを使用してください。
        </p>
        <p v-else class="screen-caption mt-3">
          データ損失・ドリフト・適用済みバージョンの不一致があると自動実行できません。更新用DDLを出力し、内容を確認して実行してください。
        </p>
        <div class="d-flex ga-2 mt-4 flex-wrap">
          <v-btn
            variant="outlined"
            prepend-icon="mdi-lan-check"
            :loading="preview.isPending.value"
            :disabled="!online || !request || !connectionId || !!running"
            @click="check"
            >事前チェック</v-btn
          >
          <v-btn
            color="primary"
            prepend-icon="mdi-lightning-bolt"
            :loading="start.isPending.value"
            :disabled="!online || !result?.canExecute || !!running || !!startedId"
            @click="kind === 'migration' ? (confirming = true) : run()"
            >{{
              `${connection?.name ?? ''} に${kind === 'build' ? 'ビルド' : 'マイグレーション'}を実行`
            }}</v-btn
          >
        </div>
      </v-card>
      <OperationError :error="preview.error.value" @reload="check" />
      <v-alert
        v-if="start.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        :text="
          mayRetrySame(start.error.value)
            ? '受付の結果を確認できませんでした。もう一度実行すると、同じ実行として確認します。'
            : (start.error.value as Error).message
        "
      />
      <v-card v-if="result && !shownId" class="mb-4">
        <v-list density="compact">
          <v-list-item
            v-for="row in checks"
            :key="row.label"
            :prepend-icon="row.ok ? 'mdi-check-circle' : 'mdi-alert-circle'"
            :base-color="row.ok ? 'success' : 'error'"
          >
            <div class="d-flex ga-3 text-high-emphasis">
              <span class="text-body-2">{{ row.label }}</span>
              <v-spacer />
              <span class="font-mono text-caption">{{ row.value }}</span>
            </div>
          </v-list-item>
        </v-list>
        <v-alert
          v-if="result.reasons.length"
          type="warning"
          variant="tonal"
          density="compact"
          class="ma-3"
        >
          <ul class="pl-4">
            <li v-for="reason in result.reasons" :key="reason">{{ reasonText(reason) }}</li>
          </ul>
        </v-alert>
      </v-card>
      <DeploymentProgress
        v-if="shownId"
        :database-id="databaseId"
        :deployment-id="shownId"
        :versions="versions"
      />
    </template>
    <v-dialog v-model="confirming" max-width="480" class="design-dialog">
      <v-card>
        <v-card-title>自動マイグレーションを実行</v-card-title>
        <v-card-text>
          <p class="mb-2">
            <strong>{{ connection?.name }}</strong> に
            <span class="font-mono">v{{ fromVersion?.number }} → v{{ toVersion?.number }}</span>
            を適用します。
          </p>
          <p class="screen-caption">
            トランザクション内の変更は失敗時にロールバックします。トランザクション外の処理（CREATE
            INDEX CONCURRENTLY
            など）で失敗した場合は、途中までの記録を実行ログに残します。自動で再実行はしません。
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirming = false">キャンセル</v-btn>
          <v-btn color="primary" variant="flat" prepend-icon="mdi-lightning-bolt" @click="run"
            >実行する</v-btn
          >
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>
