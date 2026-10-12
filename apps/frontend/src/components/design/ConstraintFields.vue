<script setup lang="ts">
import type { Target } from 'utils'
import { computed } from 'vue'

import type { Constraint, Table, DesignObject } from '../../design/object.ts'
import { coveringIndexes, fullName } from '../../design/object.ts'
import { fieldError } from '../../forms/input.ts'
import FormField from '../common/FormField.vue'
import DesignField from './DesignField.vue'
const props = defineProps<{
  table: Table
  objects: DesignObject[]
  target: Target
  disabled: boolean
  path: string
  error?: unknown
}>()
const constraint = defineModel<Constraint>({ required: true })
const columns = computed(() =>
  props.table.columns.map((c) => ({ title: c.name || '名称未入力', value: c.key })),
)
const tables = computed(() => props.objects.filter((o) => o.kind === 'table'))
const reference = computed(() => {
  const c = constraint.value
  return c.kind === 'foreign_key'
    ? tables.value.find((o) => o.objectKey === c.referenceTableKey)
    : undefined
})
const referenceName = (i: number) => {
  const c = constraint.value
  return c.kind === 'foreign_key'
    ? (referenceColumns.value.find((col) => col.value === c.referenceColumns[i])?.title ?? '未選択')
    : ''
}
const referenceColumns = computed(() =>
  reference.value?.kind === 'table'
    ? reference.value.definition.columns.map((c) => ({ title: c.name, value: c.key }))
    : [],
)
const deferred = computed({
  get: () =>
    'deferrable' in constraint.value
      ? constraint.value.initiallyDeferred
        ? 'deferred'
        : constraint.value.deferrable
          ? 'immediate'
          : 'none'
      : 'none',
  set: (v: string | null) => {
    if ('deferrable' in constraint.value) {
      constraint.value.deferrable = v !== 'none'
      constraint.value.initiallyDeferred = v === 'deferred'
    }
  },
})
const actions = ['NO ACTION', 'RESTRICT', 'CASCADE', 'SET NULL', 'SET DEFAULT']
const error = (field: string) => fieldError(props.error, `${props.path}.${field}`)
</script>
<template>
  <div class="design-fields">
    <DesignField
      v-model="constraint.name"
      label="制約名"
      required
      :disabled="disabled"
      :error="error('name')"
    />
    <FormField v-if="'columns' in constraint" v-slot="{ id }" label="カラム（選択順）" required
      ><v-select
        :id="id"
        v-model="constraint.columns"
        :items="columns"
        multiple
        chips
        :disabled="disabled"
        :error-messages="error('columns')"
        hide-details="auto"
        density="compact"
    /></FormField>
    <template v-if="constraint.kind === 'foreign_key'">
      <DesignField
        v-model="constraint.referenceTableKey"
        label="参照先テーブル"
        :items="tables.map((t) => ({ title: fullName(t, objects), value: t.objectKey }))"
        :disabled="disabled"
        :error="error('referenceTableKey')"
        @update:model-value="constraint.referenceColumns = []"
      />
      <FormField v-slot="{ id }" label="参照先カラム（対応順）" required
        ><v-select
          :id="id"
          v-model="constraint.referenceColumns"
          :items="referenceColumns"
          multiple
          chips
          :disabled="disabled"
          :error-messages="error('referenceColumns')"
          hide-details="auto"
          density="compact"
      /></FormField>
      <div v-for="(key, i) in constraint.columns" :key="key" class="column-mapping font-mono">
        {{ columns.find((c) => c.value === key)?.title }} → {{ referenceName(i) }}
      </div>
      <div class="field-pair">
        <DesignField
          v-model="constraint.onDelete"
          label="ON DELETE"
          :items="actions"
          :disabled="disabled"
        /><DesignField
          v-model="constraint.onUpdate"
          label="ON UPDATE"
          :items="actions"
          :disabled="disabled"
        />
      </div>
      <DesignField
        v-if="target === 'postgresql18'"
        v-model="constraint.match"
        label="MATCH"
        :items="['SIMPLE', 'FULL']"
        :disabled="disabled"
      />
      <p class="design-coverage">
        {{
          coveringIndexes(table, constraint.columns).length
            ? '参照元をカバーするインデックス: ' +
              coveringIndexes(table, constraint.columns).join(', ')
            : '参照元をカバーするインデックスがありません'
        }}
      </p>
    </template>
    <template v-if="constraint.kind === 'unique' && target === 'postgresql18'"
      ><v-switch
        v-model="constraint.nullsDistinct"
        label="NULLS DISTINCT"
        :disabled="disabled"
        hide-details
        inset
    /></template>
    <DesignField
      v-if="constraint.kind === 'check'"
      v-model="constraint.expression"
      label="CHECK 条件式"
      multiline
      required
      :disabled="disabled"
      :error="error('expression')"
    />
    <template v-if="constraint.kind === 'exclude'">
      <DesignField
        v-model="constraint.method"
        label="方式"
        :items="['btree', 'hash', 'gist', 'spgist', 'gin', 'brin']"
        :disabled="disabled"
      />
      <div v-for="(el, i) in constraint.elements" :key="i" class="design-fields index-key">
        <DesignField
          v-model="el.columnKey"
          label="対象カラム"
          :items="columns"
          :disabled="disabled"
          @update:model-value="el.expression = null"
        />
        <DesignField
          v-model="el.expression"
          label="または式"
          :disabled="disabled"
          @update:model-value="el.columnKey = null"
        />
        <DesignField
          v-model="el.operator"
          label="演算子"
          :disabled="disabled"
          :error="error('elements.' + i + '.operator')"
        />
        <v-btn
          variant="text"
          color="error"
          :disabled="disabled || constraint.elements.length === 1"
          @click="constraint.elements.splice(i, 1)"
          >列・式を削除</v-btn
        >
      </div>
      <v-btn
        variant="outlined"
        :disabled="disabled"
        @click="
          constraint.elements.push({
            columnKey: table.columns[0]?.key ?? null,
            expression: table.columns.length ? null : '',
            operator: '=',
          })
        "
        >列・式を追加</v-btn
      >
      <DesignField v-model="constraint.where" label="部分条件（WHERE）" :disabled="disabled" />
    </template>
    <DesignField
      v-if="
        'deferrable' in constraint &&
        (target === 'postgresql18' || constraint.kind === 'foreign_key')
      "
      v-model="deferred"
      label="遅延評価"
      :items="[
        { title: 'NOT DEFERRABLE', value: 'none' },
        { title: 'DEFERRABLE INITIALLY IMMEDIATE', value: 'immediate' },
        { title: 'DEFERRABLE INITIALLY DEFERRED', value: 'deferred' },
      ]"
      :disabled="disabled"
    />
    <v-checkbox
      v-if="'notValid' in constraint && target === 'postgresql18'"
      v-model="constraint.notValid"
      label="マイグレーション時は NOT VALID で追加"
      :disabled="disabled"
      hide-details
    />
  </div>
</template>
