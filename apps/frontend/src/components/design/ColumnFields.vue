<script setup lang="ts">
import type { Target } from 'utils'
import { computed } from 'vue'

import type { Column } from '../../design/object.ts'
import { fieldError } from '../../forms/input.ts'
import FormField from '../common/FormField.vue'
import DesignField from './DesignField.vue'
const props = defineProps<{
  target: Target
  disabled: boolean
  error?: unknown
  path: string
  compact?: boolean
}>()
const column = defineModel<Column>({ required: true })
const emit = defineEmits<{ advanced: [] }>()
const typeName = computed({
  get: () => column.value.dataType.replace(/\s*\([^)]*\)\s*$/, ''),
  set: (value: string) => {
    const length = parameters.value
    column.value.dataType = value + (length ? '(' + length + ')' : '')
  },
})
const parameters = computed({
  get: () => /\(([^)]*)\)\s*$/.exec(column.value.dataType)?.[1] ?? '',
  set: (value: string | null) => {
    column.value.dataType = typeName.value + (value ? '(' + value + ')' : '')
  },
})
const generation = computed({
  get: () => column.value.generation?.kind ?? 'none',
  set: (kind: string | null) => {
    column.value.defaultValue = null
    column.value.generation =
      kind === 'identity'
        ? { kind, always: true }
        : kind === 'generated'
          ? { kind, expression: '', stored: true }
          : null
  },
})
const types = computed(() =>
  props.target === 'sqlite3'
    ? ['INTEGER', 'REAL', 'TEXT', 'BLOB', 'ANY']
    : [
        'bigint',
        'integer',
        'smallint',
        'varchar',
        'numeric',
        'text',
        'boolean',
        'uuid',
        'date',
        'timestamp',
        'timestamptz',
        'jsonb',
        'bytea',
      ],
)
const error = (name: string) => fieldError(props.error, `${props.path}.${name}`)
</script>
<template>
  <div class="design-fields">
    <div v-if="!compact" class="field-pair">
      <DesignField
        v-model="column.name"
        label="物理名"
        required
        :disabled="disabled"
        :error="error('name')"
      /><DesignField
        v-model="column.logicalName"
        label="論理名"
        :disabled="disabled"
        :error="error('logicalName')"
        :mono="false"
      />
    </div>
    <DesignField
      v-else
      v-model="column.logicalName"
      label="論理名"
      :disabled="disabled"
      :error="error('logicalName')"
      :mono="false"
    />
    <div class="field-pair column-type-fields">
      <FormField v-slot="{ id }" label="データ型" required
        ><v-combobox
          :id="id"
          v-model="typeName"
          :items="types"
          :disabled="disabled"
          :error-messages="error('dataType')"
          hide-details="auto"
          density="compact"
          class="font-mono" /></FormField
      ><DesignField
        v-if="target === 'postgresql18'"
        v-model="parameters"
        label="長さ・精度"
        :disabled="disabled"
      />
    </div>
    <v-switch
      v-model="column.notNull"
      label="NOT NULL"
      :disabled="disabled"
      color="primary"
      hide-details
      inset
    />
    <DesignField
      v-model="column.defaultValue"
      label="デフォルト値（式）"
      :disabled="disabled || generation !== 'none'"
      :error="error('defaultValue')"
    />
    <DesignField
      v-model="generation"
      v-if="!compact"
      label="値の生成"
      :items="
        target === 'postgresql18'
          ? [
              { title: 'なし', value: 'none' },
              { title: 'IDENTITY', value: 'identity' },
              { title: '生成列', value: 'generated' },
            ]
          : [
              { title: 'なし', value: 'none' },
              { title: '生成列', value: 'generated' },
            ]
      "
      :disabled="disabled"
      :error="error('generation')"
    />
    <template v-if="!compact && column.generation?.kind === 'identity'"
      ><v-switch
        v-model="column.generation.always"
        label="GENERATED ALWAYS（OFF: BY DEFAULT）"
        :disabled="disabled"
        hide-details
        inset
    /></template>
    <template v-if="!compact && column.generation?.kind === 'generated'"
      ><DesignField
        v-model="column.generation.expression"
        label="生成式"
        :disabled="disabled" /><v-switch
        v-model="column.generation.stored"
        label="STORED（OFF: VIRTUAL）"
        :disabled="disabled"
        hide-details
        inset
    /></template>
    <v-switch
      v-if="target === 'sqlite3'"
      v-model="column.autoincrement"
      label="AUTOINCREMENT"
      :disabled="disabled"
      hide-details
      inset
    />
    <DesignField
      v-model="column.comment"
      v-if="!compact"
      label="コメント"
      multiline
      :disabled="disabled"
      :error="error('comment')"
      :mono="false"
    />
    <v-btn v-if="compact" variant="text" color="primary" size="small" @click="emit('advanced')"
      >詳細（生成・照合順序・コメント）</v-btn
    >
    <details v-else>
      <summary>詳細（照合順序・ストレージ・圧縮）</summary>
      <div class="design-fields mt-3">
        <DesignField
          v-model="column.collation"
          label="照合順序"
          :items="target === 'sqlite3' ? ['BINARY', 'NOCASE', 'RTRIM'] : undefined"
          :disabled="disabled"
          :error="error('collation')"
        />
        <template v-if="target === 'postgresql18'"
          ><DesignField
            v-model="column.storage"
            label="ストレージ"
            :items="['plain', 'external', 'extended', 'main']"
            :disabled="disabled" /><DesignField
            v-model="column.compression"
            label="圧縮"
            :items="['pglz', 'lz4']"
            :disabled="disabled"
        /></template>
      </div>
    </details>
  </div>
</template>
