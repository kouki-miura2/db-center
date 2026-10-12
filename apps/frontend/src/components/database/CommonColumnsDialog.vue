<script setup lang="ts">
import { isIdentifierWithinLimit, isAllowed, LIMITS, TARGETS, type Target } from 'utils'
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import { ApiError } from '../../api/call.ts'
import { useDatabaseMutations } from '../../composables/useDatabaseMutations.ts'
import { useDatabaseQuery } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useProductQuery } from '../../composables/useProductQuery.ts'
import { useUnsavedChanges } from '../../composables/useUnsavedChanges.ts'
import {
  copyCommonColumns,
  newCommonColumn,
  normalizeCommonColumns,
  commonColumnsReady,
} from '../../forms/common-columns.ts'
import { fieldError, maxLength, required } from '../../forms/input.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import FormField from '../common/FormField.vue'
import OperationError from '../common/OperationError.vue'
const props = defineProps<{ productId: string; databaseId: string; target: Target }>()
const open = defineModel<boolean>({ required: true })
const query = useDatabaseQuery(props.productId, props.databaseId)
const product = useProductQuery(props.productId)
const mutation = useDatabaseMutations(props.productId)
const online = useOnline()
const { xs } = useDisplay()
const notification = useNotificationStore()
const columns = ref<ReturnType<typeof copyCommonColumns>>([])
const selected = ref(0)
const valid = ref(false)
const allReady = computed(() => commonColumnsReady(columns.value, props.target))
const expectedRevision = ref<number>()
const baseline = ref('')
const dirty = computed(
  () => baseline.value !== '' && JSON.stringify(columns.value) !== baseline.value,
)
const row = computed(() => columns.value[selected.value])
useUnsavedChanges(dirty)
const identifierRule = (value: string) =>
  isIdentifierWithinLimit(props.target, value) ||
  `${TARGETS[props.target].identifierMaxBytes}バイト以内で入力してください`
const error = computed(
  () => mutation.saveCommonColumns.error.value ?? query.error.value ?? product.error.value,
)
const fieldMessages = computed(() =>
  error.value instanceof ApiError
    ? Object.entries(error.value.fields ?? {}).map(([path, message]) => ({
        index: Number(/^columns\.(\d+)/.exec(path)?.[1] ?? -1),
        message,
      }))
    : [],
)
const canEdit = computed(
  () => !!product.data.value && isAllowed(product.data.value.data.role, 'editCommonColumns'),
)
const disabled = computed(
  () => !online.value || !canEdit.value || mutation.saveCommonColumns.isPending.value,
)
const load = () => {
  if (!query.data.value) return
  columns.value = copyCommonColumns(query.data.value.data.commonColumns)
  expectedRevision.value = query.data.value.revision
  selected.value = 0
  baseline.value = JSON.stringify(columns.value)
  mutation.saveCommonColumns.reset()
}
watch(
  query.data,
  () => {
    if (baseline.value === '') load()
  },
  { immediate: true },
)
const reload = async () => {
  await query.refetch()
  load()
}
const close = () => {
  if (!dirty.value || window.confirm('未保存の変更があります。閉じますか？')) open.value = false
}
const move = (offset: number) => {
  const index = selected.value
  const next = [...columns.value]
  const [column] = next.splice(index, 1)
  if (column) next.splice(index + offset, 0, column)
  columns.value = next
  selected.value += offset
}
const addColumn = () => {
  columns.value.push(newCommonColumn())
  selected.value = columns.value.length - 1
}
const removeColumn = () => {
  columns.value.splice(selected.value, 1)
  selected.value = Math.max(0, selected.value - 1)
}
const generation = (kind: string) => {
  if (!row.value) return
  row.value.generation =
    kind === 'identity'
      ? { kind: 'identity', always: true }
      : kind === 'generated'
        ? { kind: 'generated', expression: '', stored: true }
        : null
  if (kind !== 'none') row.value.defaultValue = null
}
const field = (name: string) => fieldError(error.value, `columns.${selected.value}.${name}`)
const save = async () => {
  if (
    !expectedRevision.value ||
    disabled.value ||
    !allReady.value ||
    (!valid.value && columns.value.length > 0)
  )
    return
  try {
    await mutation.saveCommonColumns.mutateAsync({
      databaseId: props.databaseId,
      json: {
        columns: normalizeCommonColumns(columns.value),
        expectedRevision: expectedRevision.value,
      },
    })
    baseline.value = JSON.stringify(columns.value)
    open.value = false
    notification.show('共通カラムを保存しました')
  } catch {
    /* Field messages and stale-update are shown in the dialog. */
  }
}
const types = computed(() =>
  props.target === 'postgresql18'
    ? [
        'bigint',
        'integer',
        'text',
        'varchar(255)',
        'boolean',
        'timestamp',
        'timestamptz',
        'numeric(10, 2)',
        'uuid',
        'jsonb',
      ]
    : ['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'],
)
</script>
<template>
  <v-dialog
    :model-value="open"
    :fullscreen="xs"
    :persistent="dirty || mutation.saveCommonColumns.isPending.value"
    max-width="1000"
    :class="['design-dialog', 'common-columns-dialog', { 'fullscreen-form-dialog': xs }]"
    @update:model-value="
      (value) => {
        if (!value) close()
      }
    "
  >
    <v-card
      ><v-card-title class="dialog-heading d-flex align-center ga-2"
        ><v-btn
          v-if="xs"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          aria-label="共通カラムを閉じる"
          :disabled="mutation.saveCommonColumns.isPending.value"
          @click="close"
        />共通カラムのセット
        <v-chip>{{ columns.length }} / {{ LIMITS.columnsPerTable }}</v-chip></v-card-title
      >
      <v-form v-model="valid" @submit.prevent="save"
        ><v-card-text class="dialog-body">
          <OperationError :error="error" @reload="reload" />
          <div v-if="fieldMessages.length" class="mb-4">
            <v-btn
              v-for="(message, index) in fieldMessages"
              :key="index"
              variant="text"
              color="error"
              size="small"
              :disabled="message.index < 0"
              @click="selected = message.index"
              >{{ message.index >= 0 ? `カラム ${message.index + 1}: ` : ''
              }}{{ message.message }}</v-btn
            >
          </div>
          <p class="text-body-medium text-medium-emphasis mb-4">
            テーブルにまとめて追加するカラムを設定します。このセットを変更しても、追加済みのテーブルのカラムは変わりません。
          </p>
          <v-progress-linear v-if="query.isPending.value" indeterminate />
          <template v-else-if="query.data.value">
            <v-row
              ><v-col cols="12" md="4"
                ><v-list border rounded="lg" density="compact"
                  ><v-list-item
                    v-for="(column, index) in columns"
                    :key="index"
                    :active="index === selected"
                    color="primary"
                    :title="column.name || `カラム ${index + 1}`"
                    :subtitle="column.dataType || '型を入力'"
                    @click="selected = index" /><v-list-item
                    v-if="!columns.length"
                    title="共通カラムはありません" /></v-list
                ><v-btn
                  class="mt-3"
                  variant="outlined"
                  prepend-icon="mdi-plus"
                  :disabled="disabled || columns.length >= LIMITS.columnsPerTable"
                  @click="addColumn"
                  >カラムを追加</v-btn
                ></v-col
              >
              <v-col cols="12" md="8" class="column-details"
                ><template v-if="row">
                  <div class="d-flex justify-end ga-1 mb-3">
                    <v-btn
                      icon="mdi-arrow-up"
                      variant="text"
                      size="small"
                      aria-label="カラムを上へ移動"
                      :disabled="disabled || selected === 0"
                      @click="move(-1)"
                    /><v-btn
                      icon="mdi-arrow-down"
                      variant="text"
                      size="small"
                      aria-label="カラムを下へ移動"
                      :disabled="disabled || selected === columns.length - 1"
                      @click="move(1)"
                    /><v-btn
                      prepend-icon="mdi-delete-outline"
                      variant="text"
                      color="error"
                      :disabled="disabled"
                      @click="removeColumn"
                      >カラムを削除</v-btn
                    >
                  </div>
                  <FormField v-slot="{ id }" label="物理名" required
                    ><v-text-field
                      v-model="row.name"
                      :id="id"
                      hide-details="auto"
                      :disabled="disabled"
                      :rules="[required, maxLength(LIMITS.expressionMaxLength), identifierRule]"
                      :error-messages="field('name')"
                  /></FormField>
                  <FormField v-slot="{ id }" label="論理名"
                    ><v-text-field
                      v-model="row.logicalName"
                      :id="id"
                      hide-details="auto"
                      :disabled="disabled"
                      :rules="[maxLength(LIMITS.logicalNameMaxLength)]"
                      :error-messages="field('logicalName')"
                  /></FormField>
                  <FormField v-slot="{ id }" label="データ型" required
                    ><v-combobox
                      v-model="row.dataType"
                      :id="id"
                      hide-details="auto"
                      :items="types"
                      :disabled="disabled"
                      :rules="[required, maxLength(LIMITS.expressionMaxLength)]"
                      :error-messages="field('dataType')"
                      hint="長さ・精度を含めて入力できます"
                      persistent-hint
                  /></FormField>
                  <v-checkbox
                    v-model="row.notNull"
                    label="NOT NULL"
                    :disabled="disabled"
                    :error-messages="field('notNull')"
                    hide-details="auto"
                    class="mb-3"
                  />
                  <FormField v-slot="{ id }" label="デフォルト値"
                    ><v-text-field
                      :model-value="row.defaultValue || ''"
                      :id="id"
                      hide-details="auto"
                      :disabled="disabled || !!row.generation"
                      :rules="[maxLength(LIMITS.expressionMaxLength)]"
                      :error-messages="field('defaultValue')"
                      @update:model-value="row.defaultValue = $event || null"
                  /></FormField>
                  <FormField v-slot="{ id }" label="値の生成"
                    ><v-select
                      :model-value="row.generation?.kind ?? 'none'"
                      :id="id"
                      hide-details="auto"
                      :items="[
                        { value: 'none', title: 'なし' },
                        ...(target === 'postgresql18'
                          ? [{ value: 'identity', title: 'IDENTITY' }]
                          : []),
                        { value: 'generated', title: '生成列' },
                      ]"
                      :disabled="disabled"
                      :error-messages="field('generation')"
                      @update:model-value="generation"
                  /></FormField>
                  <v-checkbox
                    v-if="row.generation?.kind === 'identity'"
                    v-model="row.generation.always"
                    label="GENERATED ALWAYS（オフ: BY DEFAULT）"
                    :disabled="disabled"
                  />
                  <template v-if="row.generation?.kind === 'generated'"
                    ><FormField v-slot="{ id }" label="生成式" required
                      ><v-textarea
                        v-model="row.generation.expression"
                        :id="id"
                        hide-details="auto"
                        rows="2"
                        :rules="[required, maxLength(LIMITS.expressionMaxLength)]"
                        :disabled="disabled"
                        :error-messages="field('generation.expression')" /></FormField
                    ><v-checkbox
                      v-model="row.generation.stored"
                      label="STORED（オフ: VIRTUAL）"
                      :disabled="disabled"
                  /></template>
                  <FormField v-slot="{ id }" label="コメント"
                    ><v-textarea
                      v-model="row.comment"
                      :id="id"
                      hide-details="auto"
                      rows="2"
                      :disabled="disabled"
                      :rules="[maxLength(LIMITS.commentMaxLength)]"
                      :error-messages="field('comment')"
                  /></FormField>
                  <v-expansion-panels variant="accordion"
                    ><v-expansion-panel title="詳細"
                      ><v-expansion-panel-text>
                        <FormField v-slot="{ id }" label="照合順序" v-if="target === 'postgresql18'"
                          ><v-text-field
                            v-model="row.collation"
                            :id="id"
                            hide-details="auto"
                            :disabled="disabled"
                            :rules="[maxLength(LIMITS.expressionMaxLength)]"
                            :error-messages="field('collation')"
                        /></FormField>
                        <FormField v-slot="{ id }" label="照合順序" v-else
                          ><v-select
                            v-model="row.collation"
                            :id="id"
                            hide-details="auto"
                            :items="['BINARY', 'NOCASE', 'RTRIM']"
                            clearable
                            :disabled="disabled"
                            :error-messages="field('collation')"
                        /></FormField>
                        <template v-if="target === 'postgresql18'"
                          ><FormField v-slot="{ id }" label="ストレージ"
                            ><v-select
                              v-model="row.storage"
                              :id="id"
                              hide-details="auto"
                              :items="['plain', 'external', 'extended', 'main']"
                              clearable
                              :disabled="disabled"
                              :error-messages="field('storage')" /></FormField
                          ><FormField v-slot="{ id }" label="圧縮"
                            ><v-select
                              v-model="row.compression"
                              :id="id"
                              hide-details="auto"
                              :items="['pglz', 'lz4']"
                              clearable
                              :disabled="disabled"
                              :error-messages="field('compression')" /></FormField
                        ></template>
                        <v-checkbox
                          v-else
                          v-model="row.autoincrement"
                          label="AUTOINCREMENT（INTEGER PRIMARY KEY用）"
                          :disabled="disabled"
                          :error-messages="field('autoincrement')"
                        /> </v-expansion-panel-text></v-expansion-panel
                  ></v-expansion-panels> </template
              ></v-col>
            </v-row>
            <v-alert
              v-if="error && fieldError(error, 'columns')"
              type="error"
              variant="tonal"
              :text="fieldError(error, 'columns')"
            />
          </template> </v-card-text
        ><v-card-actions class="dialog-actions"
          ><v-spacer /><v-btn
            variant="outlined"
            :disabled="mutation.saveCommonColumns.isPending.value"
            @click="close"
            >閉じる</v-btn
          ><v-btn
            type="submit"
            color="primary"
            variant="flat"
            :loading="mutation.saveCommonColumns.isPending.value"
            :disabled="disabled || !query.data.value || !allReady || (columns.length > 0 && !valid)"
            >保存する</v-btn
          ></v-card-actions
        ></v-form
      >
    </v-card>
  </v-dialog>
</template>
