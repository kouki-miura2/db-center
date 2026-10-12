<script setup lang="ts">
import { charLength, LIMITS } from 'utils'
import { computed, onMounted, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import {
  useVersionMutations,
  type ValidationResult,
} from '../../composables/useVersionMutations.ts'
import { useVersionQuery } from '../../composables/useVersionQuery.ts'
import { fullName, toInput } from '../../design/object.ts'
import OperationError from '../common/OperationError.vue'

// Provisional (design 4i, 6i): the checks of "仮確定のチェック" (errors block it, warnings don't)
// and the changes since the previous final version, then an optional memo.
type Version = DatabaseData['versions'][number]
const props = defineProps<{
  productId: string
  databaseId: string
  version: Version
  versions: Version[]
}>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ openObject: [objectKey: string]; done: [] }>()
const { xs } = useDisplay()
const online = useOnline()
const mutations = useVersionMutations(props.productId, props.databaseId)
const objects = useVersionQuery(() => props.version.id)
const memo = ref(props.version.memo ?? '')
const checks = ref<ValidationResult>()

const previous = computed(() =>
  props.versions.find((v) => v.id === checks.value?.previousVersionId),
)
const memoError = computed(() =>
  charLength(memo.value) > LIMITS.commentMaxLength
    ? `${LIMITS.commentMaxLength}文字以内で入力してください`
    : null,
)
const error = computed(() => mutations.validate.error.value ?? mutations.provisional.error.value)

const objectName = (objectKey: string | null) => {
  const rows = objects.data.value?.data.objects ?? []
  const row = rows.find((o) => o.objectKey === objectKey)
  return row ? fullName(toInput(row), rows) : 'データベース全体'
}

const check = async () => {
  checks.value = await mutations.validate.mutateAsync(props.version.id).catch(() => undefined)
}
onMounted(check)

const submit = async () => {
  if (!checks.value || checks.value.errors > 0 || memoError.value) return
  const result = await mutations.provisional
    .mutateAsync({
      versionId: props.version.id,
      expectedUpdatedAt: checks.value.updatedAt,
      expectedRevision: checks.value.revision,
      memo: memo.value.trim() || null,
    })
    .catch(() => undefined)
  if (!result) return
  if (!result.transitioned) {
    // Someone's save added an error meanwhile: show the checks as they are now.
    checks.value = result
    return
  }
  open.value = false
  emit('done')
}

const openObject = (objectKey: string | null) => {
  if (!objectKey) return
  open.value = false
  emit('openObject', objectKey)
}
</script>

<template>
  <v-dialog
    v-model="open"
    :persistent="mutations.provisional.isPending.value"
    :max-width="xs ? '100%' : 560"
    :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <v-card-title class="d-flex align-center ga-3 flex-wrap">
        <span>v{{ version.number }} を仮確定</span>
        <span class="screen-caption">編集中 → 仮確定</span>
      </v-card-title>
      <v-card-text>
        <OperationError :error="error" @reload="check" />
        <v-progress-linear
          v-if="mutations.validate.isPending.value"
          indeterminate
          color="primary"
          aria-label="検証中"
        />
        <template v-else-if="checks">
          <h3 class="mb-2">検証結果</h3>
          <div class="d-flex ga-4 mb-3">
            <span class="d-flex align-center ga-1">
              <v-icon
                :color="checks.errors ? 'error' : 'success'"
                :icon="checks.errors ? 'mdi-alert-circle' : 'mdi-check-circle'"
                size="18"
              />エラー {{ checks.errors }}
            </span>
            <span class="d-flex align-center ga-1">
              <v-icon color="warning" icon="mdi-alert" size="18" />警告 {{ checks.warnings }}
            </span>
          </div>
          <v-list v-if="checks.issues.length" density="compact" class="issue-list mb-4">
            <v-list-item v-for="(issue, i) in checks.issues" :key="i">
              <template #prepend>
                <v-icon
                  :color="issue.severity === 'error' ? 'error' : 'warning'"
                  :icon="issue.severity === 'error' ? 'mdi-alert-circle' : 'mdi-alert'"
                  size="18"
                />
              </template>
              <v-list-item-title class="text-body-medium">
                <span class="font-mono">{{ objectName(issue.objectKey) }}</span>
                {{ issue.message }}
              </v-list-item-title>
              <template v-if="issue.objectKey" #append>
                <v-btn variant="text" size="small" @click="openObject(issue.objectKey)">開く</v-btn>
              </template>
            </v-list-item>
          </v-list>
          <h3 class="mb-2">
            {{ previous ? `v${previous.number}（確定）からの変更` : '変更' }}
          </h3>
          <div class="d-flex ga-4 mb-4 font-mono">
            <span class="text-success">+{{ checks.changes.added }} 追加</span>
            <span class="text-warning">~{{ checks.changes.changed }} 変更</span>
            <span class="text-error">−{{ checks.changes.deleted }} 削除</span>
          </div>
          <p class="screen-caption mb-4">
            仮確定すると設計は編集できなくなり、ビルド・マイグレーションの対象になります。修正が必要な場合は「編集に戻す」で再編集できます。
          </p>
          <v-textarea
            v-model="memo"
            label="メモ"
            rows="2"
            auto-grow
            :counter="LIMITS.commentMaxLength"
            :counter-value="charLength"
            :error-messages="memoError ?? undefined"
          />
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          :disabled="mutations.provisional.isPending.value"
          @click="open = false"
          >キャンセル</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          prepend-icon="mdi-check-decagram-outline"
          :loading="mutations.provisional.isPending.value"
          :disabled="!online || !checks || checks.errors > 0 || !!memoError"
          @click="submit"
          >仮確定する</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
