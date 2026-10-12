<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useVersionMutations } from '../../composables/useVersionMutations.ts'
import OperationError from '../common/OperationError.vue'

// A new version (design 4j): cloned from a final version, the latest one unless another is picked
// ("各論 > データベース > 新しいバージョン"). Only while every version is final.
type Version = DatabaseData['versions'][number]
const props = defineProps<{ productId: string; databaseId: string; versions: Version[] }>()
const open = defineModel<boolean>({ required: true })
const emit = defineEmits<{ done: [versionId: string] }>()
const { xs } = useDisplay()
const online = useOnline()
const mutations = useVersionMutations(props.productId, props.databaseId)

const finals = computed(() => props.versions.filter((v) => v.status === 'final'))
const sourceId = ref(finals.value[0]?.id)
const nextNumber = computed(() => Math.max(0, ...props.versions.map((v) => v.number)) + 1)

const submit = async () => {
  const source = finals.value.find((v) => v.id === sourceId.value)
  if (!source) return
  const created = await mutations.create
    .mutateAsync({
      versionId: source.id,
      expectedUpdatedAt: source.updatedAt,
      expectedRevision: source.revision,
    })
    .catch(() => undefined)
  if (!created) return
  open.value = false
  emit('done', created.id)
}
</script>

<template>
  <v-dialog
    v-model="open"
    :persistent="mutations.create.isPending.value"
    :max-width="xs ? '100%' : 520"
    :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <v-card-title>新しいバージョンを作成</v-card-title>
      <v-card-text>
        <OperationError :error="mutations.create.error.value" @reload="open = false" />
        <h3 class="mb-2">作成元のバージョン</h3>
        <v-radio-group v-model="sourceId" hide-details class="mb-3">
          <v-radio v-for="(v, i) in finals" :key="v.id" :value="v.id">
            <template #label>
              <span class="d-flex align-center ga-2 flex-wrap">
                <strong class="font-mono">v{{ v.number }}</strong>
                <v-chip class="version-status status-final">{{
                  i === 0 ? '確定・最新' : '確定'
                }}</v-chip>
                <span class="screen-caption">{{ v.memo }}</span>
              </span>
            </template>
          </v-radio>
        </v-radio-group>
        <p class="d-flex align-center ga-2 mb-3">
          <v-icon icon="mdi-arrow-right" size="18" />
          <strong class="font-mono">v{{ nextNumber }}</strong>
          <v-chip class="version-status status-editing">編集中</v-chip>
          として作成します
        </p>
        <p class="screen-caption">
          編集中のバージョンはデータベースごとに1つだけ作成できます。古いバージョンを作成元にした場合、差分は作成元との比較になります。
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" :disabled="mutations.create.isPending.value" @click="open = false"
          >キャンセル</v-btn
        >
        <v-btn
          color="primary"
          variant="flat"
          :loading="mutations.create.isPending.value"
          :disabled="!online || !sourceId"
          @click="submit"
          >作成して編集</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
