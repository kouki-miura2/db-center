<script setup lang="ts">
import type { Target } from 'utils'
import { computed } from 'vue'

import { type Table, bytes, defaultSize, tableEstimate } from '../../design/object.ts'
import DesignField from './DesignField.vue'
const props = defineProps<{ target: Target; disabled: boolean }>()
const table = defineModel<Table>({ required: true })
const input = computed({
  get: () => table.value.size ?? defaultSize(),
  set: (v) => {
    table.value.size = v
  },
})
const change = (field: keyof NonNullable<Table['size']>, value: unknown) => {
  input.value = { ...input.value, [field]: value }
}
const estimate = computed(() => tableEstimate(props.target, { ...table.value, size: input.value }))
</script>
<template>
  <div class="size-layout">
    <section class="design-card design-fields">
      <h3>見積もり条件</h3>
      <div class="size-average">
        <span>平均行サイズ（自動算出）</span
        ><strong class="font-mono">{{ bytes(estimate?.averageRowBytes) }}</strong>
      </div>
      <DesignField
        :model-value="input.initialRows"
        label="初期件数（移行データ）"
        numeric
        :disabled="disabled"
        @update:model-value="change('initialRows', $event)"
      />
      <DesignField
        :model-value="input.unit"
        label="時間単位"
        :items="[
          { title: '時間', value: 'hour' },
          { title: '日', value: 'day' },
          { title: '月', value: 'month' },
        ]"
        :disabled="disabled"
        @update:model-value="change('unit', $event)"
      />
      <DesignField
        v-for="[key, label] in [
          ['inserts', 'INSERT'],
          ['updates', 'UPDATE'],
          ['deletes', 'DELETE'],
        ] as const"
        :key="key"
        :model-value="input[key]"
        :label="label"
        numeric
        :disabled="disabled"
        @update:model-value="change(key, $event)"
      />
      <div class="field-pair">
        <DesignField
          :model-value="input.peakFactor"
          label="ピーク係数"
          numeric
          :disabled="disabled"
          @update:model-value="change('peakFactor', $event)"
        /><DesignField
          :model-value="input.retentionYears"
          label="保持期間（年）"
          numeric
          hint="空欄: 期限なし"
          :disabled="disabled"
          @update:model-value="change('retentionYears', $event)"
        />
      </div>
      <DesignField
        :model-value="input.memo"
        label="メモ（根拠）"
        multiline
        :mono="false"
        :disabled="disabled"
        @update:model-value="change('memo', $event)"
      />
    </section>
    <div class="design-fields">
      <div class="design-table-wrap">
        <table class="design-table">
          <thead>
            <tr>
              <th>時点</th>
              <th>件数</th>
              <th>テーブル</th>
              <th>インデックス</th>
              <th>合計</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="snapshot in estimate?.snapshots" :key="snapshot.years">
              <td>{{ snapshot.years ? snapshot.years + '年後' : '初期' }}</td>
              <td class="font-mono">{{ snapshot.rows.toLocaleString() }}</td>
              <td class="font-mono">{{ bytes(snapshot.tableBytes) }}</td>
              <td class="font-mono">{{ bytes(snapshot.indexBytes) }}</td>
              <td class="font-mono">
                <strong>{{ bytes(snapshot.totalBytes) }}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <v-alert v-if="!estimate" type="error" variant="tonal"
        >件数は0以上、ピーク係数は1以上、保持期間は正の数で入力してください。</v-alert
      >
      <div v-if="estimate" class="size-results">
        <section class="design-card">
          <p>ピーク時書き込み</p>
          <strong class="font-mono">{{ estimate.peakWritesPerSecond.toFixed(2) }} 件/秒</strong>
        </section>
        <section v-if="target === 'postgresql18'" class="design-card">
          <p>不要タプル発生</p>
          <strong class="font-mono"
            >{{ estimate.deadTuplesPerUnit.toLocaleString() }} 件/{{
              input.unit === 'hour' ? '時' : input.unit === 'day' ? '日' : '月'
            }}</strong
          >
        </section>
        <section v-if="target === 'postgresql18'" class="design-card">
          <p>WAL 生成（概算）</p>
          <strong class="font-mono">{{ bytes(estimate.walBytesPerUnit ?? undefined) }}</strong>
        </section>
      </div>
    </div>
  </div>
</template>
