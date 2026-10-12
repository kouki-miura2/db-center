<script setup lang="ts">
import type { Target } from 'utils'
import { computed } from 'vue'

import { type DesignObject, kindLabels, bytes, tableEstimate } from '../../design/object.ts'
import DesignField from './DesignField.vue'
const props = defineProps<{
  schemaKey: string
  objects: DesignObject[]
  target: Target
  disabled: boolean
  changes: Map<string, string>
}>()
const schema = defineModel<Extract<DesignObject, { kind: 'schema' }>['definition']>({
  required: true,
})
defineEmits<{ select: [key: string]; remove: []; add: [] }>()
const children = computed(() =>
  props.objects
    .filter((o) => o.schemaKey === props.schemaKey)
    .toSorted((a, b) => a.name.localeCompare(b.name)),
)
const total = computed(() =>
  children.value.reduce(
    (sum, o) =>
      sum +
      (o.kind === 'table'
        ? (tableEstimate(props.target, o.definition)?.snapshots[3]?.totalBytes ?? 0)
        : 0),
    0,
  ),
)
</script>
<template>
  <div class="schema-editor design-fields">
    <section class="design-card schema-fields">
      <slot name="identity" />
      <DesignField v-model="schema.owner" label="所有者ロール" :disabled="disabled" /><DesignField
        v-model="schema.comment"
        label="コメント"
        :mono="false"
        :disabled="disabled"
      />
    </section>
    <div class="inline-actions">
      <h3>配下のオブジェクト</h3>
      <v-spacer /><v-btn
        variant="outlined"
        prepend-icon="mdi-plus"
        :disabled="disabled"
        @click="$emit('add')"
        >オブジェクトを追加</v-btn
      >
    </div>
    <div class="design-table-wrap">
      <table class="design-table">
        <thead>
          <tr>
            <th>種別</th>
            <th>物理名</th>
            <th>論理名</th>
            <th>カラム</th>
            <th>インデックス</th>
            <th>5年後サイズ</th>
            <th>変更</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="o in children"
            :key="o.objectKey"
            tabindex="0"
            @click="$emit('select', o.objectKey)"
            @keydown.enter="$emit('select', o.objectKey)"
          >
            <td>{{ kindLabels[o.kind] }}</td>
            <td class="font-mono">{{ o.name }}</td>
            <td>{{ o.logicalName || '—' }}</td>
            <td>{{ o.kind === 'table' ? o.definition.columns.length : '—' }}</td>
            <td>
              {{
                o.kind === 'table'
                  ? o.definition.indexes.length +
                    o.definition.constraints.filter(
                      (c) => c.kind === 'unique' || c.kind === 'primary_key',
                    ).length
                  : '—'
              }}
            </td>
            <td class="font-mono">
              {{
                o.kind === 'table'
                  ? bytes(tableEstimate(target, o.definition)?.snapshots[3]?.totalBytes)
                  : '—'
              }}
            </td>
            <td class="change-mark">{{ changes.get(o.objectKey) || '—' }}</td>
          </tr>
          <tr>
            <td colspan="5"><strong>合計</strong></td>
            <td class="font-mono">{{ bytes(total) }}</td>
            <td />
          </tr>
        </tbody>
      </table>
    </div>
    <section class="schema-delete">
      <div>
        <strong>スキーマを削除</strong>
        <p>
          {{
            children.length
              ? children.length +
                '件のオブジェクトを含むため削除できません。先に配下のオブジェクトを削除してください。'
              : '配下にオブジェクトはありません。'
          }}
        </p>
      </div>
      <v-btn
        variant="outlined"
        color="error"
        :disabled="disabled || children.length > 0"
        @click="$emit('remove')"
        >削除する</v-btn
      >
    </section>
  </div>
</template>
