<script setup lang="ts">
import { TARGETS, type Target } from 'utils'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import VersionChip from './VersionChip.vue'

// The database screens' header (design `DbHeader`): product and database, the version shown with
// its status, the sections (設計・ビルド・マイグレーション・バージョン履歴) and the actions slot.
type Version = DatabaseData['versions'][number]
export type DatabaseSection = 'design' | 'build' | 'migration' | 'history'

const props = defineProps<{
  productId: string
  databaseId: string
  section: DatabaseSection
  productName: string
  target: Target
  databaseName: string
  /** The version shown (on the design screen) or acted on (the latest one elsewhere). */
  version: Version
  versions: Version[]
  /** The back button's target, when not the database list (the object list on a phone). */
  backLabel?: string
}>()
const emit = defineEmits<{ back: [] }>()
const router = useRouter()
const { xs } = useDisplay()

const statusLabels = { editing: '編集中', provisional: '仮確定', final: '確定' } as const
const params = computed(() => ({ productId: props.productId, databaseId: props.databaseId }))

const sections = computed(() =>
  (
    [
      ['design', '設計', '設計', 'mdi-pencil-ruler'],
      ['build', 'ビルド', 'ビルド', 'mdi-hammer-wrench'],
      ['migration', 'マイグレーション', 'マイグレーション', 'mdi-swap-horizontal'],
      ['history', 'バージョン履歴', '履歴', 'mdi-history'],
    ] as const
  ).map(([id, label, short, icon]) => ({
    id,
    label: xs.value ? short : label,
    icon,
    to:
      id === 'design'
        ? { name: 'design', params: { ...params.value, versionId: props.version.id } }
        : { name: `database-${id}`, params: params.value },
  })),
)

const changeVersion = (versionId: string) =>
  router.push({ name: 'design', params: { ...params.value, versionId } })

const back = () => {
  if (props.backLabel) emit('back')
  else void router.push({ name: 'product', params: { productId: props.productId } })
}
</script>

<template>
  <header class="db-header">
    <v-btn
      icon="mdi-arrow-left"
      variant="text"
      size="small"
      :aria-label="backLabel ?? 'データベース一覧に戻る'"
      @click="back"
    />
    <div class="db-title">
      <small v-if="!xs">{{ productName }} · {{ TARGETS[target].label }}</small>
      <strong class="font-mono">{{ databaseName }}</strong>
    </div>
    <v-menu>
      <template #activator="{ props: menu }">
        <v-btn
          v-if="xs"
          v-bind="menu"
          variant="text"
          size="small"
          class="mobile-version px-1"
          append-icon="mdi-chevron-down"
          :aria-label="'表示するバージョン: v' + version.number"
          ><VersionChip :version="version"
        /></v-btn>
        <v-btn
          v-else
          v-bind="menu"
          variant="outlined"
          append-icon="mdi-chevron-down"
          class="version-select"
          ><VersionChip :version="version"
        /></v-btn>
      </template>
      <v-list density="compact">
        <v-list-item
          v-for="v in versions"
          :key="v.id"
          :title="`v${v.number} · ${statusLabels[v.status]}`"
          :active="section === 'design' && v.id === version.id"
          @click="changeVersion(v.id)"
        />
      </v-list>
    </v-menu>
    <nav class="db-navigation" aria-label="データベースの画面">
      <router-link
        v-for="item in sections"
        :key="item.id"
        v-slot="{ navigate }"
        :to="item.to"
        custom
      >
        <button :class="{ active: section === item.id }" @click="navigate">
          <v-icon size="17">{{ item.icon }}</v-icon
          >{{ item.label }}
        </button>
      </router-link>
    </nav>
    <div class="db-actions">
      <slot name="actions" />
    </div>
  </header>
</template>
