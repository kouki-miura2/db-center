<script setup lang="ts">
import { formatDate } from 'utils'
import { computed } from 'vue'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useDeploymentProgress, useDeploymentScript } from '../../composables/useDeployments.ts'
import { reasonText } from '../../composables/useDeployments.ts'
import { currentStep, failureText, logRows, seconds } from '../../deployment/log.ts'
import { downloadFile } from '../../export/download.ts'
import OperationError from '../common/OperationError.vue'

// A deployment's progress and result (design 4m 4o): read again while it runs, the step groups
// with their counts and times, and the log and SQL to download. It runs on with the screen closed.
const props = defineProps<{
  databaseId: string
  deploymentId: string
  versions: DatabaseData['versions']
}>()
const progress = useDeploymentProgress(props.databaseId, () => props.deploymentId)
const script = useDeploymentScript()
const row = computed(() => progress.data.value)

const numberOf = (versionId: string | null) =>
  props.versions.find((v) => v.id === versionId)?.number
const versionsLabel = computed(() => {
  if (!row.value) return ''
  const to = `v${numberOf(row.value.toVersionId) ?? '?'}`
  return row.value.fromVersionId ? `v${numberOf(row.value.fromVersionId) ?? '?'} → ${to}` : to
})
const kindLabel = computed(() => (row.value?.kind === 'build' ? 'ビルド' : 'マイグレーション'))
const total = computed(() => logRows(row.value?.log ?? null).reduce((s, r) => s + r.durationMs, 0))

const downloadLog = () => {
  if (!row.value) return
  downloadFile(
    `deployment_${row.value.id}_log.json`,
    JSON.stringify(row.value.log ?? {}, null, 2),
    'application/json;charset=utf-8',
  )
}
const downloadSql = async () => {
  if (!row.value) return
  const result = await script.mutateAsync(row.value.id).catch(() => undefined)
  if (result) downloadFile(result.fileName, result.sql, 'application/sql;charset=utf-8')
}
</script>

<template>
  <v-card class="deployment-progress">
    <OperationError
      :error="progress.error.value ?? script.error.value"
      @reload="progress.refetch()"
    />
    <v-progress-linear v-if="!row" indeterminate color="primary" aria-label="読み込み中" />
    <template v-else>
      <div class="d-flex align-center flex-wrap ga-3 px-4 py-3 border-b">
        <v-progress-circular
          v-if="row.status === 'running'"
          indeterminate
          size="20"
          width="2"
          color="primary"
        />
        <v-icon
          v-else
          :icon="row.status === 'succeeded' ? 'mdi-check-circle' : 'mdi-alert-circle'"
          :color="row.status === 'succeeded' ? 'success' : 'error'"
        />
        <strong>
          {{
            row.status === 'running'
              ? `${kindLabel}実行中`
              : row.status === 'succeeded'
                ? `${kindLabel}が完了しました`
                : `${kindLabel}に失敗しました`
          }}
        </strong>
        <span class="screen-caption">
          {{ row.connectionName }} ・ {{ versionsLabel }} ・ 実行者 {{ row.executedByName }} ・
          {{ formatDate(new Date(row.startedAt), 'yyyy/MM/dd HH:mm') }}
        </span>
        <v-spacer />
        <span v-if="total" class="font-mono text-body-2">{{ seconds(total) }}</span>
      </div>
      <v-list density="compact">
        <v-list-item v-for="(step, i) in logRows(row.log)" :key="i" prepend-icon="mdi-check">
          <div class="d-flex ga-3">
            <span class="text-body-2">{{ step.label }}</span>
            <span class="font-mono text-body-2 text-medium-emphasis">{{ step.statements }}</span>
            <v-spacer />
            <span class="font-mono text-caption">{{ seconds(step.durationMs) }}</span>
          </div>
        </v-list-item>
        <v-list-item v-if="row.status === 'running'">
          <template #prepend>
            <v-progress-circular indeterminate size="16" width="2" class="mr-8" />
          </template>
          <span class="text-body-2">{{ currentStep(row.log) ?? '準備中' }}</span>
        </v-list-item>
      </v-list>
      <div class="px-4 pb-4">
        <v-alert
          v-if="row.status === 'failed'"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-2"
        >
          {{ failureText(row.log) ?? '実行に失敗しました' }}
          <ul v-if="row.log?.precheckReasons?.length" class="mt-1 pl-4">
            <li v-for="reason in row.log.precheckReasons" :key="reason">
              {{ reasonText(reason) }}
            </li>
          </ul>
          <div v-if="row.log?.requiresInspection" class="mt-1">
            結果が確定していない可能性があります。実行ログで途中までの記録を確認し、接続先の状態（適用記録
            <code>_dbcenter.version</code>）を確認してください。自動で再実行はしません。
          </div>
          <div v-else-if="row.log?.committed" class="mt-1">
            トランザクション内の変更はコミット済みです。トランザクション外の処理で失敗しました。
          </div>
        </v-alert>
        <p v-if="row.status === 'running'" class="screen-caption mb-2">
          画面を閉じても実行は継続します。結果はバージョン履歴の実行履歴で確認できます。
        </p>
        <div class="d-flex ga-2 flex-wrap">
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-download"
            :disabled="!row.log"
            @click="downloadLog"
            >実行ログ</v-btn
          >
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-file-code-outline"
            :loading="script.isPending.value"
            @click="downloadSql"
            >実行したDDL</v-btn
          >
        </div>
      </div>
    </template>
  </v-card>
</template>
