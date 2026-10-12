<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useVersionMutations } from '../../composables/useVersionMutations.ts'
import OperationError from '../common/OperationError.vue'

// Final (design 4i, 6q): each connection's applied state read from the connection itself, then
// finalize, optionally creating the next version. A connection that can't be read doesn't block
// it ("ビルド・マイグレーション > 自動ビルド・自動マイグレーション").
type Version = DatabaseData['versions'][number]
const props = defineProps<{ productId: string; databaseId: string; version: Version }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [createdVersionId: string | null] }>()
const { xs } = useDisplay()
const online = useOnline()
const mutations = useVersionMutations(props.productId, props.databaseId)
const createNext = ref(true)

const states = {
  applied: { icon: 'mdi-check-circle', color: 'success', label: 'この設計を適用済み' },
  different: { icon: 'mdi-alert-circle-outline', color: 'warning', label: '別の設計を適用済み' },
  unapplied: { icon: 'mdi-radiobox-blank', color: 'medium-emphasis', label: '未適用' },
  unknown: { icon: 'mdi-help-circle-outline', color: 'medium-emphasis', label: '接続状態不明' },
  unsupported: {
    icon: 'mdi-help-circle-outline',
    color: 'medium-emphasis',
    label: '確認できません',
  },
} as const

/** The API sends the status as a string; anything unexpected shows as unknown. */
const state = (status: string) => states[status as keyof typeof states] ?? states.unknown

onMounted(() => void mutations.finalizePreview.mutateAsync(props.version.id).catch(() => {}))

const submit = async () => {
  const result = await mutations.finalize
    .mutateAsync({
      versionId: props.version.id,
      expectedUpdatedAt: props.version.updatedAt,
      expectedRevision: props.version.revision,
      memo: props.version.memo,
      createNext: createNext.value,
    })
    .catch(() => undefined)
  if (!result) return
  open.value = false
  emit('done', result.createdVersion?.id ?? null)
}
</script>

<template>
  <v-dialog
    v-model="open"
    :persistent="mutations.finalize.isPending.value"
    :max-width="xs ? '100%' : 520"
    :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <v-card-title class="d-flex align-center ga-3 flex-wrap">
        <v-icon icon="mdi-check-decagram" color="primary" size="22" />
        <span>v{{ version.number }} を確定</span>
        <span class="screen-caption">仮確定 → 確定</span>
      </v-card-title>
      <v-card-text>
        <OperationError :error="mutations.finalize.error.value" @reload="open = false" />
        <p class="mb-4">
          確定後は編集に戻せません。変更する場合は新しいバージョン（v{{
            version.number + 1
          }}）を作成します。
        </p>
        <h3 class="mb-2">v{{ version.number }} の適用状況</h3>
        <v-progress-linear
          v-if="mutations.finalizePreview.isPending.value"
          indeterminate
          color="primary"
          aria-label="接続先を確認中"
          class="mb-4"
        />
        <v-alert
          v-else-if="mutations.finalizePreview.error.value"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-4"
          >接続先の適用状況を確認できませんでした。確定はできます。</v-alert
        >
        <template v-else-if="mutations.finalizePreview.data.value">
          <p
            v-if="mutations.finalizePreview.data.value.connections.length === 0"
            class="screen-caption mb-4"
          >
            データベース接続情報はありません。
          </p>
          <v-list v-else density="compact" class="mb-4">
            <v-list-item
              v-for="connection in mutations.finalizePreview.data.value.connections"
              :key="connection.id"
              :prepend-icon="state(connection.status).icon"
              :base-color="state(connection.status).color"
            >
              <v-list-item-title class="text-body-2 text-high-emphasis">
                {{ connection.name }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ state(connection.status).label
                }}{{ connection.applied ? `（v${connection.applied.versionNumber}）` : '' }}
              </v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </template>
        <v-checkbox
          v-model="createNext"
          hide-details
          :label="`確定後、続けて v${version.number + 1}（編集中）を作成する`"
        />
        <p class="screen-caption mt-2">確定はオーナー・マネージャーのみ実行できます</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="mutations.finalize.isPending.value" @click="open = false"
          >キャンセル</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          :loading="mutations.finalize.isPending.value"
          :disabled="!online"
          @click="submit"
          >確定する</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
