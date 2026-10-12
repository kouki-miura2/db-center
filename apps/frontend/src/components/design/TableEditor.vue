<script setup lang="ts">
import { LIMITS, type Target } from 'utils'
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import { ApiError } from '../../api/call.ts'
import type { CommonColumn } from '../../composables/useDatabaseQuery.ts'
import { useSortable } from '../../composables/useSortable.ts'
import {
  type Table,
  type Constraint,
  type Index,
  type DesignObject,
  bytes,
  changeOf,
  tableEstimate,
  newColumn,
  removeColumn,
  copy as copyData,
} from '../../design/object.ts'
import DeleteDialog from '../common/DeleteDialog.vue'
import OperationError from '../common/OperationError.vue'
import ColumnFields from './ColumnFields.vue'
import ConstraintFields from './ConstraintFields.vue'
import DesignField from './DesignField.vue'
import IndexFields from './IndexFields.vue'
import SizeEditor from './SizeEditor.vue'
const props = defineProps<{
  target: Target
  disabled: boolean
  objects: DesignObject[]
  commonColumns: CommonColumn[]
  previous?: Table
  sourceNumber?: number
  error?: unknown
  ddl?: string
  ddlPending: boolean
  ddlError?: unknown
}>()
const table = defineModel<Table>({ required: true })
const emit = defineEmits<{ common: []; ddl: []; identity: [] }>()
const { xs, mdAndUp } = useDisplay()
const tab = defineModel<string>('tab', { default: 'columns' })
const selected = ref<string>()
const sheet = ref(false)
const columnSheet = ref(false)
const deletion = ref(false)
const common = ref(false)
const el = ref<HTMLElement>()
const columns = computed({
  get: () => table.value.columns,
  set: (v) => {
    table.value.columns = v
  },
})
useSortable(
  el,
  columns,
  computed(() => props.disabled),
)
const row = computed(() => table.value.columns.find((c) => c.key === selected.value))
const constraint = computed(() => table.value.constraints.find((c) => c.key === selected.value))
const index = computed(() => table.value.indexes.find((c) => c.key === selected.value))
const selectedName = computed(
  () => row.value?.name ?? constraint.value?.name ?? index.value?.name ?? '',
)
const selectedKind = computed(() =>
  tab.value === 'columns' ? 'カラム' : tab.value === 'constraints' ? '制約' : 'インデックス',
)
const path = computed(
  () =>
    `definition.${tab.value}.${tab.value === 'columns' ? table.value.columns.findIndex((c) => c.key === selected.value) : tab.value === 'constraints' ? table.value.constraints.findIndex((c) => c.key === selected.value) : table.value.indexes.findIndex((c) => c.key === selected.value)}`,
)
const estimate = computed(() => tableEstimate(props.target, table.value))
const autoIndexes = computed(() =>
  table.value.constraints.filter(
    (c) => c.kind === 'primary_key' || c.kind === 'unique' || c.kind === 'exclude',
  ),
)
const select = (key: string) => {
  selected.value = selected.value === key && xs.value && tab.value === 'columns' ? undefined : key
  sheet.value = !!selected.value && xs.value && tab.value !== 'columns'
}
watch(
  tab,
  () => {
    selected.value = undefined
    sheet.value = false
    if (tab.value === 'ddl') emit('ddl')
  },
  { immediate: true },
)
const addColumn = () => {
  const col = newColumn(props.target)
  table.value.columns.push(col)
  selected.value = col.key
}
const addConstraint = (kind: Constraint['kind']) => {
  const base = { key: crypto.randomUUID(), name: '' }
  const selectedColumns = table.value.columns[0] ? [table.value.columns[0].key] : []
  const value: Constraint =
    kind === 'primary_key'
      ? { ...base, kind, columns: selectedColumns }
      : kind === 'unique'
        ? {
            ...base,
            kind,
            columns: selectedColumns,
            nullsDistinct: true,
            deferrable: false,
            initiallyDeferred: false,
          }
        : kind === 'check'
          ? { ...base, kind, expression: '', notValid: false }
          : kind === 'exclude'
            ? {
                ...base,
                kind,
                method: 'gist',
                elements: [
                  {
                    columnKey: table.value.columns[0]?.key ?? null,
                    expression: table.value.columns.length ? null : '',
                    operator: '=',
                  },
                ],
                where: null,
                deferrable: false,
                initiallyDeferred: false,
              }
            : {
                ...base,
                kind: 'foreign_key',
                columns: selectedColumns,
                referenceTableKey: '',
                referenceColumns: [],
                onDelete: 'NO ACTION',
                onUpdate: 'NO ACTION',
                match: 'SIMPLE',
                deferrable: false,
                initiallyDeferred: false,
                notValid: false,
              }
  table.value.constraints.push(value)
  selected.value = value.key
  sheet.value = xs.value
}
const addIndex = () => {
  const value: Index = {
    key: crypto.randomUUID(),
    name: '',
    method: 'btree',
    columns: [
      {
        columnKey: table.value.columns[0]?.key ?? null,
        expression: table.value.columns.length ? null : '',
        order: 'ASC',
        nulls: null,
      },
    ],
    include: [],
    where: null,
    unique: false,
    fillfactor: null,
    concurrently: false,
  }
  table.value.indexes.push(value)
  selected.value = value.key
  sheet.value = xs.value
}
const commonNames = ref<string[]>([])
const addCommon = () => {
  for (const col of props.commonColumns.filter((c) => commonNames.value.includes(c.name)))
    table.value.columns.push({ ...copyData(col), key: crypto.randomUUID() })
  common.value = false
  commonNames.value = []
}
const remove = () => {
  if (!selected.value) return
  if (tab.value === 'columns') removeColumn(table.value, selected.value)
  else if (tab.value === 'constraints')
    table.value.constraints = table.value.constraints.filter((c) => c.key !== selected.value)
  else table.value.indexes = table.value.indexes.filter((i) => i.key !== selected.value)
  selected.value = undefined
  sheet.value = false
  deletion.value = false
}
const mark = (kind: 'columns' | 'constraints' | 'indexes', key: string) => {
  if (props.sourceNumber === undefined) return ''
  return changeOf(
    table.value[kind].find((c) => c.key === key),
    props.previous?.[kind].find((c) => c.key === key),
  )
}
const columnNames = (keys: string[]) =>
  keys.map((k) => table.value.columns.find((c) => c.key === k)?.name ?? '参照なし').join(', ')
const summary = (c: Constraint) =>
  c.kind === 'check'
    ? c.expression
    : c.kind === 'foreign_key'
      ? '→ ' + (props.objects.find((o) => o.objectKey === c.referenceTableKey)?.name ?? '未選択')
      : c.kind === 'exclude'
        ? 'EXCLUDE USING ' + c.method
        : c.kind === 'primary_key'
          ? 'インデックスを自動作成'
          : c.nullsDistinct
            ? 'NULLS DISTINCT'
            : 'NULLS NOT DISTINCT'
const constraintLabel = (kind: Constraint['kind']) => kind.replaceAll('_', ' ').toUpperCase()
const columnMarks = (key: string) =>
  table.value.constraints
    .filter((c) => 'columns' in c && c.columns.includes(key))
    .map((c) =>
      c.kind === 'primary_key'
        ? 'PK'
        : c.kind === 'foreign_key'
          ? 'FK'
          : c.kind === 'unique'
            ? 'UQ'
            : 'CK',
    )
    .join(' ')
const rowError = (kind: string, i: number) =>
  props.error instanceof ApiError
    ? Object.entries(props.error.fields ?? {})
        .filter(
          ([p]) => p === `definition.${kind}.${i}` || p.startsWith(`definition.${kind}.${i}.`),
        )
        .map(([, m]) => m)
        .join(' / ')
    : ''
const moveColumn = (i: number, d: number) => {
  const next = [...columns.value]
  const [item] = next.splice(i, 1)
  if (item) next.splice(i + d, 0, item)
  columns.value = next
}
const copy = async () => {
  if (props.ddl) await navigator.clipboard.writeText(props.ddl)
}
</script>
<template>
  <div class="object-tabs">
    <button
      v-for="[key, label, count] in [
        ['columns', 'カラム', table.columns.length],
        ['constraints', '制約', table.constraints.length],
        ['indexes', 'インデックス', table.indexes.length + autoIndexes.length],
        ['size', 'サイズ設計'],
        ['settings', 'テーブル設定'],
        ['ddl', 'DDL'],
      ]"
      :key="key"
      :class="{ active: tab === key }"
      @click="tab = String(key)"
    >
      {{ label }} <small v-if="count !== undefined">{{ count }}</small>
    </button>
  </div>
  <div
    v-if="['columns', 'constraints', 'indexes'].includes(tab)"
    class="table-editor-layout"
    :class="{ 'has-detail': selected && mdAndUp }"
  >
    <div class="table-editor-list">
      <div v-if="tab === 'columns'" class="column-list">
        <div class="column-row column-head">
          <span>#</span><span>PK</span><span>物理名</span><span>論理名</span><span>データ型</span
          ><span>NN</span><span>デフォルト</span><span>制約</span>
        </div>
        <div ref="el">
          <div
            v-for="(col, i) in table.columns"
            :key="col.key"
            data-sortable
            :class="[
              'column-item',
              { selected: selected === col.key, added: mark('columns', col.key) === 'A' },
            ]"
          >
            <button
              class="column-row"
              :class="{ 'drag-handle': xs }"
              :aria-label="col.name + 'を編集'"
              @click="select(col.key)"
            >
              <span class="drag-handle"
                >{{ i + 1 }}<small>{{ mark('columns', col.key) }}</small></span
              ><span class="column-pk"
                ><v-icon v-if="columnMarks(col.key).includes('PK')" size="15" color="primary"
                  >mdi-key-outline</v-icon
                ></span
              ><span class="font-mono column-name"
                >{{ col.name || '名称未入力'
                }}<small class="phone-only">{{ col.dataType }} · {{ col.logicalName }}</small></span
              ><span class="column-logical">{{ col.logicalName || '—' }}</span
              ><span class="column-type font-mono">{{ col.dataType }}</span
              ><span class="column-nn">{{ col.notNull ? '✓' : '—' }}</span
              ><span class="column-default font-mono">{{
                col.generation?.kind === 'identity'
                  ? 'IDENTITY'
                  : col.autoincrement
                    ? 'AUTOINCREMENT'
                    : col.defaultValue || '—'
              }}</span
              ><span class="column-tags"
                ><small>{{ columnMarks(col.key) }}</small
                ><v-icon v-if="xs" size="18">{{
                  selected === col.key ? 'mdi-chevron-up' : 'mdi-chevron-down'
                }}</v-icon></span
              >
            </button>
            <p v-if="rowError('columns', i)" class="field-error">{{ rowError('columns', i) }}</p>
            <div v-if="xs && selected === col.key" class="column-inline">
              <ColumnFields
                v-model="table.columns[i]!"
                compact
                @advanced="columnSheet = true"
                :target="target"
                :disabled="disabled"
                :path="'definition.columns.' + i"
                :error="error"
              />
              <div class="inline-actions">
                <v-btn
                  size="small"
                  variant="text"
                  :disabled="disabled || i === 0"
                  @click="moveColumn(i, -1)"
                  >上へ</v-btn
                ><v-btn
                  size="small"
                  variant="text"
                  :disabled="disabled || i === table.columns.length - 1"
                  @click="moveColumn(i, 1)"
                  >下へ</v-btn
                ><v-spacer /><v-btn
                  size="small"
                  variant="text"
                  color="error"
                  :disabled="disabled"
                  @click="deletion = true"
                  >削除</v-btn
                >
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="design-table-wrap">
        <table class="design-table object-row-table">
          <thead>
            <tr v-if="tab === 'constraints'">
              <th>種別</th>
              <th>制約名</th>
              <th>対象カラム</th>
              <th>定義</th>
            </tr>
            <tr v-else>
              <th>インデックス名</th>
              <th>方式</th>
              <th>キー列／条件</th>
              <th>UNIQUE</th>
              <th>5年後</th>
            </tr>
          </thead>
          <tbody>
            <template v-if="tab === 'constraints'"
              ><tr
                v-for="(c, i) in table.constraints"
                :key="c.key"
                :class="{ selected: selected === c.key, added: mark('constraints', c.key) === 'A' }"
                tabindex="0"
                @click="select(c.key)"
                @keydown.enter="select(c.key)"
              >
                <td>
                  <span class="constraint-tag">{{ constraintLabel(c.kind) }}</span>
                </td>
                <td class="font-mono">
                  {{ c.name || '名称未入力' }}
                  <small class="change-mark">{{ mark('constraints', c.key) }}</small>
                  <p v-if="rowError('constraints', i)" class="field-error">
                    {{ rowError('constraints', i) }}
                  </p>
                </td>
                <td class="font-mono">{{ 'columns' in c ? columnNames(c.columns) : '—' }}</td>
                <td class="font-mono row-definition">{{ summary(c) }}</td>
              </tr></template
            >
            <template v-else
              ><tr v-for="(c, autoIndex) in autoIndexes" :key="c.key" class="auto-index">
                <td class="font-mono">{{ c.name }}<small>制約により自動作成</small></td>
                <td>{{ c.kind === 'exclude' ? c.method : 'btree' }}</td>
                <td class="font-mono">
                  {{
                    'columns' in c
                      ? columnNames(c.columns)
                      : c.kind === 'exclude'
                        ? c.elements
                            .map((e) => (e.columnKey ? columnNames([e.columnKey]) : e.expression))
                            .join(', ')
                        : ''
                  }}
                </td>
                <td>{{ c.kind === 'exclude' ? '—' : '✓' }}</td>
                <td class="font-mono index-size">
                  {{ bytes(estimate?.snapshots[3]?.indexSizes[table.indexes.length + autoIndex]) }}
                </td>
              </tr>
              <tr
                v-for="(item, i) in table.indexes"
                :key="item.key"
                :class="{
                  selected: selected === item.key,
                  added: mark('indexes', item.key) === 'A',
                }"
                tabindex="0"
                @click="select(item.key)"
                @keydown.enter="select(item.key)"
              >
                <td class="font-mono">
                  {{ item.name || '名称未入力' }}
                  <small class="change-mark">{{ mark('indexes', item.key) }}</small>
                  <p v-if="rowError('indexes', i)" class="field-error">
                    {{ rowError('indexes', i) }}
                  </p>
                </td>
                <td>{{ item.method }}</td>
                <td class="font-mono row-definition">
                  {{
                    item.columns
                      .map((c) => (c.columnKey ? columnNames([c.columnKey]) : c.expression))
                      .join(', ')
                  }}
                  {{ item.where ? 'WHERE ' + item.where : '' }}
                </td>
                <td>{{ item.unique ? '✓' : '—' }}</td>
                <td class="font-mono index-size">
                  {{ bytes(estimate?.snapshots[3]?.indexSizes[i]) }}
                </td>
              </tr></template
            >
          </tbody>
        </table>
      </div>
      <p v-if="tab === 'columns' && !table.columns.length" class="empty-design">
        カラムを追加して設計を開始してください
      </p>
      <div class="table-list-actions" :class="{ 'phone-fixed': xs && tab === 'columns' }">
        <template v-if="tab === 'columns'"
          ><v-btn
            variant="outlined"
            prepend-icon="mdi-plus"
            :disabled="disabled || table.columns.length >= LIMITS.columnsPerTable"
            @click="addColumn"
            >カラムを追加</v-btn
          ><v-btn
            variant="outlined"
            prepend-icon="mdi-table-column-plus-before"
            :disabled="disabled"
            @click="common = true"
            >共通カラム</v-btn
          ><span class="screen-caption desktop-only"
            >ドラッグで並べ替え · 平均行サイズ 約 {{ bytes(estimate?.averageRowBytes) }}</span
          ></template
        >
        <v-menu v-else-if="tab === 'constraints'"
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              variant="outlined"
              prepend-icon="mdi-plus"
              append-icon="mdi-chevron-down"
              :disabled="disabled"
              >制約を追加</v-btn
            ></template
          ><v-list
            ><v-list-item
              v-for="kind in (target === 'sqlite3'
                ? ['primary_key', 'foreign_key', 'unique', 'check']
                : [
                    'primary_key',
                    'foreign_key',
                    'unique',
                    'check',
                    'exclude',
                  ]) as Constraint['kind'][]"
              :key="kind"
              :title="constraintLabel(kind)"
              :disabled="kind === 'primary_key' && table.constraints.some((c) => c.kind === kind)"
              @click="addConstraint(kind)" /></v-list
        ></v-menu>
        <template v-else
          ><v-btn variant="outlined" prepend-icon="mdi-plus" :disabled="disabled" @click="addIndex"
            >インデックスを追加</v-btn
          ><span class="screen-caption"
            >インデックス合計（5年後） {{ bytes(estimate?.snapshots[3]?.indexBytes) }}</span
          ></template
        >
      </div>
      <p v-if="sourceNumber !== undefined" class="screen-caption change-legend">
        A v{{ sourceNumber }}から追加 · M v{{ sourceNumber }}から変更
      </p>
      <template v-if="target === 'sqlite3' && tab === 'columns'"
        ><div class="design-card mt-3">
          <h3>テーブルオプション（SQLite）</h3>
          <div class="inline-actions">
            <v-checkbox
              v-model="table.options.strict"
              label="STRICT"
              :disabled="disabled"
              hide-details
            /><v-checkbox
              v-model="table.options.withoutRowid"
              label="WITHOUT ROWID"
              :disabled="disabled"
              hide-details
            />
          </div></div
      ></template>
    </div>
    <section v-if="selected && (!xs || tab !== 'columns') && !xs" class="object-detail">
      <div class="detail-title">
        <h3>{{ selectedKind }}詳細</h3>
        <v-spacer /><v-btn
          icon="mdi-close"
          variant="text"
          size="x-small"
          aria-label="詳細を閉じる"
          @click="selected = undefined"
        />
      </div>
      <ColumnFields
        v-if="row"
        v-model="table.columns[table.columns.findIndex((c) => c.key === selected)]!"
        :target="target"
        :disabled="disabled"
        :path="path"
        :error="error"
      />
      <ConstraintFields
        v-if="constraint"
        v-model="table.constraints[table.constraints.findIndex((c) => c.key === selected)]!"
        :table="table"
        :objects="objects"
        :target="target"
        :disabled="disabled"
        :path="path"
        :error="error"
      />
      <IndexFields
        v-if="index"
        v-model="table.indexes[table.indexes.findIndex((c) => c.key === selected)]!"
        :table="table"
        :target="target"
        :disabled="disabled"
        :path="path"
        :error="error"
      />
      <p
        v-if="
          row &&
          previous?.columns.some((c) => c.key === row?.key) &&
          mark('columns', row.key) === 'M'
        "
        class="change-mark mt-3"
      >
        v{{ sourceNumber }}:
        {{ previous.columns.find((c) => c.key === row?.key)?.dataType }} から変更
      </p>
      <v-btn
        variant="text"
        color="error"
        prepend-icon="mdi-trash-can-outline"
        class="detail-delete"
        :disabled="disabled"
        @click="deletion = true"
        >{{ selectedKind }}を削除</v-btn
      >
    </section>
  </div>
  <div v-else class="table-tab-content">
    <SizeEditor v-if="tab === 'size'" v-model="table" :target="target" :disabled="disabled" />
    <section v-else-if="tab === 'settings'" class="design-card design-fields">
      <v-btn variant="outlined" :disabled="disabled" @click="emit('identity')"
        >物理名・論理名を変更</v-btn
      ><DesignField
        v-model="table.comment"
        label="コメント"
        multiline
        :disabled="disabled"
        :mono="false"
      /><DesignField
        v-if="target === 'postgresql18'"
        v-model="table.options.fillfactor"
        label="fillfactor"
        numeric
        :disabled="disabled"
      /><template v-else
        ><v-switch
          v-model="table.options.strict"
          label="STRICT"
          :disabled="disabled"
          hide-details
          inset /><v-switch
          v-model="table.options.withoutRowid"
          label="WITHOUT ROWID"
          :disabled="disabled"
          hide-details
          inset
      /></template>
    </section>
    <section v-else class="design-card">
      <div class="detail-title">
        <h3>テーブル DDL</h3>
        <v-spacer /><v-btn
          variant="outlined"
          prepend-icon="mdi-content-copy"
          :disabled="!ddl"
          @click="copy"
          >コピー</v-btn
        ><v-btn variant="text" :loading="ddlPending" @click="emit('ddl')">再生成</v-btn>
      </div>
      <OperationError :error="ddlError" /><v-progress-linear v-if="ddlPending" indeterminate />
      <pre class="sql-preview">{{ ddl || 'DDL は生成後に表示されます' }}</pre>
    </section>
  </div>
  <v-dialog v-model="columnSheet" class="design-dialog bottom-sheet-dialog" max-width="100%"
    ><v-card
      ><div class="sheet-handle" />
      <v-card-title>カラム詳細</v-card-title
      ><v-card-text
        ><ColumnFields
          v-if="row"
          v-model="table.columns[table.columns.findIndex((c) => c.key === selected)]!"
          :target="target"
          :disabled="disabled"
          :path="path"
          :error="error" /></v-card-text
      ><v-card-actions
        ><v-btn color="primary" variant="flat" block @click="columnSheet = false"
          >完了</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <v-dialog v-model="sheet" class="design-dialog bottom-sheet-dialog" max-width="100%"
    ><v-card
      ><div class="sheet-handle" />
      <v-card-title>{{ selectedName || selectedKind + '詳細' }}</v-card-title
      ><v-card-text
        ><ConstraintFields
          v-if="constraint"
          v-model="table.constraints[table.constraints.findIndex((c) => c.key === selected)]!"
          :table="table"
          :objects="objects"
          :target="target"
          :disabled="disabled"
          :path="path"
          :error="error" /><IndexFields
          v-if="index"
          v-model="table.indexes[table.indexes.findIndex((c) => c.key === selected)]!"
          :table="table"
          :target="target"
          :disabled="disabled"
          :path="path"
          :error="error" /></v-card-text
      ><v-card-actions
        ><v-btn variant="text" color="error" :disabled="disabled" @click="deletion = true"
          >削除</v-btn
        ><v-btn color="primary" variant="flat" block @click="sheet = false"
          >完了</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
  <DeleteDialog
    v-if="deletion"
    v-model="deletion"
    :name="selectedName"
    :kind="selectedKind"
    detail="この変更はオブジェクトを保存したときに反映されます。カラムを削除すると、そのカラムを使う制約・インデックスも削除します。"
    :pending="false"
    :error="undefined"
    @confirm="remove"
  />
  <v-dialog v-model="common" class="design-dialog" max-width="500"
    ><v-card
      ><v-card-title>共通カラム</v-card-title
      ><v-card-text
        ><p class="screen-caption mb-3">選択したカラムを独立したカラムとして追加します。</p>
        <v-checkbox
          v-for="col in commonColumns"
          :key="col.name"
          v-model="commonNames"
          :value="col.name"
          :label="col.name + ' · ' + col.dataType"
          :disabled="disabled || table.columns.some((c) => c.name === col.name)"
          hide-details
        />
        <p v-if="!commonColumns.length">共通カラムは未登録です</p>
        <v-btn variant="text" :disabled="disabled" @click="emit('common')"
          >セットを編集</v-btn
        ></v-card-text
      ><v-card-actions
        ><v-btn variant="text" @click="common = false">キャンセル</v-btn
        ><v-btn
          color="primary"
          variant="flat"
          :disabled="
            disabled ||
            !commonNames.length ||
            table.columns.length + commonNames.length > LIMITS.columnsPerTable
          "
          @click="addCommon"
          >選択したカラムを追加</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
