<script setup lang="ts">
import { computed } from 'vue'

import type { Sequence, DesignObject } from '../../design/object.ts'
import { fullName } from '../../design/object.ts'
import { fieldError } from '../../forms/input.ts'
import DesignField from './DesignField.vue'
const props = defineProps<{
  objects: DesignObject[]
  name: string
  schemaKey: string | null
  disabled: boolean
  error?: unknown
}>()
const value = defineModel<Sequence>({ required: true })
const owners = computed(() =>
  props.objects.flatMap((o) =>
    o.kind === 'table'
      ? o.definition.columns.map((c) => ({
          title: fullName(o, props.objects) + '.' + c.name,
          value: o.objectKey + '/' + c.key,
        }))
      : [],
  ),
)
const owned = computed({
  get: () =>
    value.value.ownedBy ? value.value.ownedBy.tableKey + '/' + value.value.ownedBy.columnKey : null,
  set: (v: string | null) => {
    const [tableKey, columnKey] = v?.split('/') ?? []
    value.value.ownedBy = tableKey && columnKey ? { tableKey, columnKey } : null
  },
})
const quote = (v: string) => '"' + v.replaceAll('"', '""') + '"'
const qualified = computed(() =>
  [props.objects.find((o) => o.objectKey === props.schemaKey)?.name, props.name]
    .filter((v): v is string => !!v)
    .map(quote)
    .join('.'),
)
const preview = computed(
  () =>
    `CREATE SEQUENCE ${qualified.value}\n  AS ${value.value.dataType} START WITH ${value.value.start}\n  INCREMENT BY ${value.value.increment} CACHE ${value.value.cache}\n  ${value.value.min === null ? 'NO MINVALUE' : 'MINVALUE ' + value.value.min} ${value.value.max === null ? 'NO MAXVALUE' : 'MAXVALUE ' + value.value.max}\n  ${value.value.cycle ? 'CYCLE' : 'NO CYCLE'}${value.value.ownedBy ? '\n  OWNED BY ' + ownedName(value.value.ownedBy.tableKey, value.value.ownedBy.columnKey) : ''};`,
)
const ownedName = (tableKey: string, columnKey: string) => {
  const table = props.objects.find((o) => o.objectKey === tableKey)
  if (table?.kind !== 'table') return 'NONE'
  return [
    props.objects.find((o) => o.objectKey === table.schemaKey)?.name,
    table.name,
    table.definition.columns.find((c) => c.key === columnKey)?.name,
  ]
    .filter((v): v is string => !!v)
    .map(quote)
    .join('.')
}
const usages = computed(() =>
  props.objects.flatMap((o) =>
    o.kind === 'table'
      ? o.definition.columns
          .filter((c) => c.defaultValue?.includes(props.name) && props.name)
          .map((c) => ({
            name: fullName(o, props.objects) + '.' + c.name,
            expression: c.defaultValue,
          }))
      : [],
  ),
)
</script>
<template>
  <div class="sequence-layout">
    <section class="design-card design-fields">
      <div class="field-pair sequence-identity"><slot name="identity" /></div>
      <DesignField
        v-model="value.dataType"
        label="データ型"
        :items="['smallint', 'integer', 'bigint']"
        :disabled="disabled"
      />
      <div class="field-pair">
        <DesignField
          v-model="value.start"
          label="開始値"
          required
          :disabled="disabled"
          :error="fieldError(error, 'definition.start')"
        /><DesignField
          v-model="value.increment"
          label="増分"
          required
          :disabled="disabled"
          :error="fieldError(error, 'definition.increment')"
        />
      </div>
      <div class="field-pair">
        <DesignField v-model="value.min" label="最小値" :disabled="disabled" /><DesignField
          v-model="value.max"
          label="最大値"
          :disabled="disabled"
        />
      </div>
      <DesignField
        v-model="value.cache"
        label="キャッシュ"
        required
        :disabled="disabled"
      /><v-switch
        v-model="value.cycle"
        label="循環（CYCLE）"
        :disabled="disabled"
        hide-details
        inset
      />
      <DesignField
        v-model="owned"
        label="所有カラム（OWNED BY）"
        :items="[{ title: 'なし', value: '' }, ...owners]"
        :disabled="disabled"
      /><DesignField
        v-model="value.comment"
        label="コメント"
        multiline
        :mono="false"
        :disabled="disabled"
      />
    </section>
    <div class="design-fields">
      <section class="design-card">
        <h3>使用箇所</h3>
        <p v-if="!usages.length" class="screen-caption">使用箇所はありません</p>
        <div v-for="usage in usages" :key="usage.name" class="sequence-usage font-mono">
          {{ usage.name }}<small>{{ usage.expression }}</small>
        </div>
      </section>
      <pre class="sql-preview">{{ preview }}</pre>
    </div>
  </div>
</template>
