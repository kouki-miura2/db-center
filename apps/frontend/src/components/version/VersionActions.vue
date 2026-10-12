<script setup lang="ts">
import { isAllowed, type Role, type Target } from 'utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import type { DatabaseData } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import DefinitionExportDialog from './DefinitionExportDialog.vue'
import FinalizeDialog from './FinalizeDialog.vue'
import NewVersionDialog from './NewVersionDialog.vue'
import ProvisionalDialog from './ProvisionalDialog.vue'
import RevertDialog from './RevertDialog.vue'

// The version actions of the database header (design `DbHeader`): 定義書 (any version), 仮確定
// (editing), 編集に戻す and 確定 (provisional), 新しいバージョン (when every version is final). A button the role may not use
// is hidden ("総論 > 権限"). On a phone they're items of the header's menu, with the `menu` slot's.
type Version = DatabaseData['versions'][number]
type Action = 'definition' | 'provisional' | 'revert' | 'finalize' | 'create'
const props = defineProps<{
  productId: string
  databaseId: string
  version: Version
  versions: Version[]
  role: Role
  target: Target
  databaseName: string
  /** The design screen has unsaved edits, which a provisional version wouldn't include. */
  dirty?: boolean
}>()
const router = useRouter()
const { xs } = useDisplay()
const online = useOnline()
const notification = useNotificationStore()
const dialog = ref<Action | null>(null)

const latestIsFinal = computed(() => props.versions.every((v) => v.status === 'final'))
const actions = computed(() =>
  (
    [
      {
        id: 'definition',
        label: '定義書',
        icon: 'mdi-file-document-outline',
        shown: isAllowed(props.role, 'exportDefinition'),
        primary: false,
      },
      {
        id: 'provisional',
        label: '仮確定',
        icon: 'mdi-check-decagram-outline',
        shown: props.version.status === 'editing' && isAllowed(props.role, 'provisionalVersion'),
        primary: true,
      },
      {
        id: 'revert',
        label: '編集に戻す',
        icon: 'mdi-undo',
        shown: props.version.status === 'provisional' && isAllowed(props.role, 'revertVersion'),
        primary: false,
      },
      {
        id: 'finalize',
        label: '確定',
        icon: 'mdi-check-decagram',
        shown: props.version.status === 'provisional' && isAllowed(props.role, 'finalizeVersion'),
        primary: true,
      },
      {
        id: 'create',
        label: '新しいバージョン',
        icon: 'mdi-plus',
        shown: latestIsFinal.value && isAllowed(props.role, 'createVersion'),
        primary: false,
      },
    ] satisfies { id: Action; label: string; icon: string; shown: boolean; primary: boolean }[]
  ).filter((action) => action.shown),
)

const start = (id: Action) => {
  if (
    id === 'provisional' &&
    props.dirty &&
    !window.confirm('未保存の変更は仮確定に含まれません。保存せずに続けますか？')
  )
    return
  dialog.value = id
}

const params = computed(() => ({ productId: props.productId, databaseId: props.databaseId }))
const openVersion = (versionId: string) =>
  router.push({ name: 'design', params: { ...params.value, versionId } })

const onProvisional = () => notification.show(`v${props.version.number} を仮確定しました`)
const onRevert = () => notification.show(`v${props.version.number} を編集に戻しました`)
const onFinalize = async (createdVersionId: string | null) => {
  notification.show(`v${props.version.number} を確定しました`)
  if (createdVersionId) await openVersion(createdVersionId)
}
const onCreate = async (versionId: string) => {
  notification.show('新しいバージョンを作成しました')
  await openVersion(versionId)
}
const openObject = (objectKey: string) =>
  router.push({
    name: 'design-object',
    params: { ...params.value, versionId: props.version.id, objectKey },
  })
</script>

<template>
  <template v-if="!xs">
    <slot name="before" />
    <v-btn
      v-for="action in actions"
      :key="action.id"
      :color="action.primary ? 'primary' : undefined"
      :variant="action.primary ? 'flat' : 'outlined'"
      :prepend-icon="action.icon"
      :disabled="!online"
      @click="start(action.id)"
      >{{ action.label }}</v-btn
    >
    <slot name="after" />
  </template>
  <v-menu v-else>
    <template #activator="{ props: menu }">
      <v-btn
        v-bind="menu"
        icon="mdi-dots-vertical"
        variant="text"
        size="small"
        aria-label="データベースの操作"
      />
    </template>
    <v-list density="compact">
      <slot name="menu" />
      <v-list-item
        v-for="action in actions"
        :key="action.id"
        :prepend-icon="action.icon"
        :title="action.label"
        :disabled="!online"
        @click="start(action.id)"
      />
    </v-list>
  </v-menu>
  <DefinitionExportDialog
    v-if="dialog === 'definition'"
    :model-value="true"
    :product-id="productId"
    :database-id="databaseId"
    :database-name="databaseName"
    :target="target"
    :version="version"
    :versions="versions"
    @update:model-value="dialog = null"
  />
  <ProvisionalDialog
    v-if="dialog === 'provisional'"
    :model-value="true"
    :product-id="productId"
    :database-id="databaseId"
    :version="version"
    :versions="versions"
    @update:model-value="dialog = null"
    @open-object="openObject"
    @done="onProvisional"
  />
  <RevertDialog
    v-if="dialog === 'revert'"
    :model-value="true"
    :product-id="productId"
    :database-id="databaseId"
    :version="version"
    @update:model-value="dialog = null"
    @done="onRevert"
  />
  <FinalizeDialog
    v-if="dialog === 'finalize'"
    :model-value="true"
    :product-id="productId"
    :database-id="databaseId"
    :version="version"
    @update:model-value="dialog = null"
    @done="onFinalize"
  />
  <NewVersionDialog
    v-if="dialog === 'create'"
    :model-value="true"
    :product-id="productId"
    :database-id="databaseId"
    :versions="versions"
    @update:model-value="dialog = null"
    @done="onCreate"
  />
</template>
