<script setup lang="ts">
import type { Target } from 'utils'
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import {
  type DesignObject,
  kindLabels,
  kindIcons,
  bytes,
  tableEstimate,
} from '../../design/object.ts'
const props = defineProps<{
  objects: DesignObject[]
  target: Target
  selected?: string
  changes: Map<string, string>
  sourceNumber?: number
  counts: { added: number; modified: number; deleted: number }
  disabled: boolean
}>()
const emit = defineEmits<{
  select: [key: string]
  add: [kind: DesignObject['kind'], schemaKey: string | null]
  common: []
}>()
const search = ref('')
const { xs } = useDisplay()
const schema = ref<string | null>(null)
const schemas = computed(() =>
  props.objects.filter((o) => o.kind === 'schema').toSorted((a, b) => a.name.localeCompare(b.name)),
)
watch(
  schemas,
  (rows) => {
    if (!schema.value || !rows.some((o) => o.objectKey === schema.value))
      schema.value = rows[0]?.objectKey ?? null
  },
  { immediate: true },
)
const kinds = computed(() =>
  props.target === 'sqlite3'
    ? (['table', 'view'] as const)
    : (['table', 'view', 'materialized_view', 'sequence'] as const),
)
const match = (o: DesignObject) =>
  [o.name, o.logicalName]
    .join(' ')
    .toLowerCase()
    .includes((search.value || '').toLowerCase())
const children = (key: string | null, kind?: DesignObject['kind']) =>
  props.objects
    .filter(
      (o) => o.schemaKey === key && o.kind !== 'schema' && (!kind || o.kind === kind) && match(o),
    )
    .toSorted(
      (a, b) =>
        kinds.value.indexOf(a.kind as never) - kinds.value.indexOf(b.kind as never) ||
        a.name.localeCompare(b.name),
    )
const groups = computed(() =>
  props.target === 'sqlite3'
    ? [{ key: null, name: '', rows: children(null) }]
    : schemas.value.map((o) => ({ key: o.objectKey, name: o.name, rows: children(o.objectKey) })),
)
const availableKinds = computed(() =>
  props.target === 'sqlite3'
    ? (['table', 'view'] as const)
    : (['schema', 'table', 'view', 'sequence'] as const),
)
</script>
<template>
  <aside class="schema-tree" :class="{ 'mobile-object-list': xs }">
    <div v-if="xs && target === 'postgresql18'" class="schema-chips">
      <button
        v-for="s in schemas"
        :key="s.objectKey"
        :class="{ active: schema === s.objectKey }"
        class="font-mono"
        @click="schema = s.objectKey"
      >
        {{ s.name }}</button
      ><v-spacer /><v-btn
        icon="mdi-cog-outline"
        variant="text"
        size="small"
        aria-label="スキーマを編集"
        :disabled="!schema"
        @click="schema && emit('select', schema)"
      />
    </div>
    <div class="tree-search">
      <v-text-field
        v-model="search"
        aria-label="オブジェクトを検索"
        placeholder="オブジェクトを検索"
        prepend-inner-icon="mdi-magnify"
        hide-details
        clearable
        density="compact"
      /><v-menu v-if="!xs"
        ><template #activator="{ props: menu }"
          ><v-btn
            v-bind="menu"
            icon="mdi-plus"
            size="small"
            color="primary-soft"
            :disabled="disabled"
            aria-label="オブジェクトを追加" /></template
        ><v-list
          ><v-list-item
            v-for="kind in availableKinds"
            :key="kind"
            :title="kindLabels[kind] + 'を追加'"
            @click="emit('add', kind, kind === 'schema' ? null : schema)" /></v-list
      ></v-menu>
    </div>
    <div class="tree-scroll">
      <template v-if="xs"
        ><div class="mobile-objects">
          <button
            v-for="o in children(target === 'sqlite3' ? null : schema)"
            :key="o.objectKey"
            class="mobile-object"
            @click="emit('select', o.objectKey)"
          >
            <v-icon :icon="kindIcons[o.kind]" size="19" /><span
              ><strong class="font-mono"
                >{{ o.name }}
                <small class="change-mark">{{ changes.get(o.objectKey) }}</small></strong
              ><small>{{ kindLabels[o.kind] }} · {{ o.logicalName || '—' }}</small></span
            ><span class="object-size font-mono">{{
              o.kind === 'table'
                ? bytes(tableEstimate(target, o.definition)?.snapshots[3]?.totalBytes)
                : '—'
            }}</span
            ><v-icon size="18">mdi-chevron-right</v-icon>
          </button>
        </div></template
      >
      <template v-else
        ><details v-for="group in groups" :key="group.key ?? 'main'" open class="tree-group">
          <summary v-if="target === 'postgresql18'" :class="{ selected: selected === group.key }">
            <button class="font-mono" @click.prevent="group.key && emit('select', group.key)">
              <v-icon size="16">mdi-folder-outline</v-icon>{{ group.name }}</button
            ><small>{{ group.rows.length }}</small>
          </summary>
          <div v-for="kind in kinds" :key="kind">
            <div class="tree-kind">
              {{ kindLabels[kind] }}<v-spacer /><small>{{ children(group.key, kind).length }}</small
              ><button
                :disabled="disabled"
                :aria-label="group.name + 'に' + kindLabels[kind] + 'を追加'"
                @click="emit('add', kind, group.key)"
              >
                ＋
              </button>
            </div>
            <button
              v-for="o in children(group.key, kind)"
              :key="o.objectKey"
              :class="['tree-object', { selected: selected === o.objectKey }]"
              @click="emit('select', o.objectKey)"
            >
              <v-icon :icon="kindIcons[kind]" size="15" /><span class="font-mono">{{ o.name }}</span
              ><small class="change-mark">{{ changes.get(o.objectKey) }}</small>
            </button>
          </div>
        </details></template
      >
      <p v-if="!objects.some(match)" class="empty-design">該当するオブジェクトはありません</p>
    </div>
    <div class="tree-footer">
      <div>
        <p v-if="sourceNumber !== undefined">v{{ sourceNumber }} からの変更</p>
        <span class="change-added">A 追加 {{ counts.added }}</span
        ><span class="change-mark">M 変更 {{ counts.modified }}</span
        ><span class="change-deleted">D 削除 {{ counts.deleted }}</span>
      </div>
      <v-menu v-if="xs"
        ><template #activator="{ props: menu }"
          ><v-btn v-bind="menu" color="primary" prepend-icon="mdi-plus" :disabled="disabled"
            >追加</v-btn
          ></template
        ><v-list
          ><v-list-item
            v-for="kind in availableKinds"
            :key="kind"
            :title="kindLabels[kind] + 'を追加'"
            @click="emit('add', kind, kind === 'schema' ? null : schema)" /></v-list
      ></v-menu>
    </div>
  </aside>
</template>
