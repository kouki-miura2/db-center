<script setup lang="ts">
import type { Target } from 'utils'
import { computed, ref } from 'vue'

import { useSortable } from '../../composables/useSortable.ts'
import type { Index, Table } from '../../design/object.ts'
import { fieldError } from '../../forms/input.ts'
import FormField from '../common/FormField.vue'
import DesignField from './DesignField.vue'
const props = defineProps<{
  table: Table
  target: Target
  disabled: boolean
  path: string
  error?: unknown
}>()
const index = defineModel<Index>({ required: true })
const columns = computed(() => props.table.columns.map((c) => ({ title: c.name, value: c.key })))
const el = ref<HTMLElement>()
const keys = computed({
  get: () => index.value.columns,
  set: (v) => {
    index.value.columns = v
  },
})
useSortable(
  el,
  keys,
  computed(() => props.disabled),
)
const move = (i: number, direction: number) => {
  const rows = [...keys.value]
  const [row] = rows.splice(i, 1)
  if (row) rows.splice(i + direction, 0, row)
  keys.value = rows
}
</script>
<template>
  <div class="design-fields">
    <DesignField
      v-model="index.name"
      label="インデックス名"
      required
      :disabled="disabled"
      :error="fieldError(error, path + '.name')"
    />
    <DesignField
      v-model="index.method"
      label="方式"
      :items="
        target === 'postgresql18' ? ['btree', 'hash', 'gist', 'spgist', 'gin', 'brin'] : ['btree']
      "
      :disabled="disabled"
    />
    <p class="field-label">キー列・式（長押しで並べ替え）</p>
    <div ref="el" class="design-fields">
      <div v-for="(key, i) in index.columns" :key="i" data-sortable class="index-key design-fields">
        <div class="index-key-title">
          <span class="drag-handle" aria-hidden="true">⠿</span><span>キー {{ i + 1 }}</span
          ><v-spacer /><v-btn
            icon="mdi-arrow-up"
            size="x-small"
            variant="text"
            :disabled="disabled || i === 0"
            aria-label="キーを上へ"
            @click="move(i, -1)"
          /><v-btn
            icon="mdi-arrow-down"
            size="x-small"
            variant="text"
            :disabled="disabled || i === index.columns.length - 1"
            aria-label="キーを下へ"
            @click="move(i, 1)"
          /><v-btn
            icon="mdi-close"
            size="x-small"
            variant="text"
            :disabled="disabled || index.columns.length === 1"
            aria-label="キーを削除"
            @click="index.columns.splice(i, 1)"
          />
        </div>
        <DesignField
          v-model="key.columnKey"
          label="カラム"
          :items="columns"
          :disabled="disabled"
          @update:model-value="key.expression = null"
        />
        <DesignField
          v-model="key.expression"
          label="または式"
          :disabled="disabled"
          @update:model-value="key.columnKey = null"
          :error="fieldError(error, path + '.columns.' + i + '.expression')"
        />
        <div class="field-pair">
          <DesignField
            v-model="key.order"
            label="順序"
            :items="['ASC', 'DESC']"
            :disabled="disabled"
          /><DesignField
            v-if="target === 'postgresql18'"
            v-model="key.nulls"
            label="NULLS"
            :items="['FIRST', 'LAST']"
            :disabled="disabled"
          />
        </div>
        <DesignField
          v-if="target === 'postgresql18'"
          v-model="key.operatorClass"
          label="演算子クラス"
          :disabled="disabled"
        />
      </div>
    </div>
    <v-btn
      variant="outlined"
      prepend-icon="mdi-plus"
      :disabled="disabled"
      @click="
        index.columns.push({
          columnKey: table.columns[0]?.key ?? null,
          expression: table.columns.length ? null : '',
          order: 'ASC',
          nulls: null,
        })
      "
      >列・式を追加</v-btn
    >
    <FormField v-if="target === 'postgresql18'" v-slot="{ id }" label="INCLUDE 列"
      ><v-select
        :id="id"
        v-model="index.include"
        :items="columns.filter((c) => !index.columns.some((k) => k.columnKey === c.value))"
        multiple
        chips
        :disabled="disabled"
        hide-details="auto"
        density="compact"
    /></FormField>
    <DesignField v-model="index.where" label="部分インデックス条件（WHERE）" :disabled="disabled" />
    <v-checkbox v-model="index.unique" label="UNIQUE" :disabled="disabled" hide-details />
    <template v-if="target === 'postgresql18'"
      ><DesignField
        v-model="index.fillfactor"
        label="fillfactor"
        numeric
        :disabled="disabled" /><v-checkbox
        v-model="index.concurrently"
        label="マイグレーション時は CONCURRENTLY で作成"
        :disabled="disabled"
        hide-details
    /></template>
    <p
      v-for="fk in table.constraints.filter(
        (c) =>
          c.kind === 'foreign_key' &&
          !index.where &&
          c.columns.every((k, i) => index.columns[i]?.columnKey === k),
      )"
      :key="fk.key"
      class="design-coverage"
    >
      FK {{ fk.name }} をカバー
    </p>
  </div>
</template>
