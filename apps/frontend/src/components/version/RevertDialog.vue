<script setup lang="ts">
import { ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useVersionMutations } from '../../composables/useVersionMutations.ts'
import OperationError from '../common/OperationError.vue'

// Back to editing ("仮確定 → 編集中"): when a connection had this version applied, the API asks
// to confirm the drift first ("適用済みの接続先と設計がずれます"). Not while one is running.
type Version = DatabaseData['versions'][number]
const props = defineProps<{ productId: string; databaseId: string; version: Version }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [] }>()
const { xs } = useDisplay()
const online = useOnline()
const mutations = useVersionMutations(props.productId, props.databaseId)
const warning = ref<{ message: string; connections: string[] }>()

const submit = async () => {
  const result = await mutations.revert
    .mutateAsync({
      versionId: props.version.id,
      expectedUpdatedAt: props.version.updatedAt,
      expectedRevision: props.version.revision,
      memo: props.version.memo,
      acknowledgeApplied: !!warning.value,
    })
    .catch(() => undefined)
  if (!result) return
  if (!result.transitioned) {
    warning.value = {
      message: result.warning,
      connections: [
        ...new Set(
          result.applications.filter((v) => v.status === 'succeeded').map((v) => v.connectionName),
        ),
      ],
    }
    return
  }
  open.value = false
  emit('done')
}
</script>

<template>
  <v-dialog
    v-model="open"
    :persistent="mutations.revert.isPending.value"
    :max-width="xs ? '100%' : 480"
    :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <v-card-title>v{{ version.number }} を編集に戻しますか？</v-card-title>
      <v-card-text>
        <OperationError :error="mutations.revert.error.value" @reload="open = false" />
        <p class="mb-3">仮確定を解除し、再び設計を編集できるようにします。</p>
        <v-alert v-if="warning" type="warning" variant="tonal" density="compact">
          {{ warning.message }}
          <div v-if="warning.connections.length" class="mt-1">
            適用済みの接続先: {{ warning.connections.join('、') }}
          </div>
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="mutations.revert.isPending.value" @click="open = false"
          >キャンセル</v-btn
        >
        <v-btn
          :color="warning ? 'warning' : 'primary'"
          variant="flat"
          prepend-icon="mdi-undo"
          :loading="mutations.revert.isPending.value"
          :disabled="!online"
          @click="submit"
          >{{ warning ? 'ずれを承知して編集に戻す' : '編集に戻す' }}</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
