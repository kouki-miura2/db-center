<script setup lang="ts">
import { LIMITS, isAllowed, utf8ByteLength } from 'utils'
import { computed, ref, watch, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { ApiError } from '../api/call.ts'
import DeleteDialog from '../components/common/DeleteDialog.vue'
import OperationError from '../components/common/OperationError.vue'
import CommonColumnsDialog from '../components/database/CommonColumnsDialog.vue'
import DbHeader from '../components/database/DbHeader.vue'
import DesignField from '../components/design/DesignField.vue'
import ObjectNames from '../components/design/ObjectNames.vue'
import SchemaEditor from '../components/design/SchemaEditor.vue'
import SchemaTree from '../components/design/SchemaTree.vue'
import SequenceEditor from '../components/design/SequenceEditor.vue'
import TableEditor from '../components/design/TableEditor.vue'
import VersionActions from '../components/version/VersionActions.vue'
import { useDatabaseQuery } from '../composables/useDatabaseQuery.ts'
import { useObjectMutations, type ObjectInput } from '../composables/useObjectMutations.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'
import { useUnsavedChanges } from '../composables/useUnsavedChanges.ts'
import { useVersionQuery } from '../composables/useVersionQuery.ts'
import {
  type DesignObject,
  kindIcons,
  kindLabels,
  toInput,
  objectChanges,
  newObject,
  duplicateObject,
  fullName,
  inputProblems,
  fieldLabel,
} from '../design/object.ts'
import { useNotificationStore } from '../stores/notification.ts'
const ViewEditor = defineAsyncComponent(() => import('../components/design/ViewEditor.vue'))
const props = defineProps<{
  productId: string
  databaseId: string
  versionId?: string
  objectKey?: string
}>()
const router = useRouter()
const route = useRoute()
const { xs, mdAndUp } = useDisplay()
const online = useOnline()
const notification = useNotificationStore()
const database = useDatabaseQuery(props.productId, props.databaseId)
const product = useProductQuery(props.productId)
const query = useVersionQuery(() => props.versionId ?? '')
const source = useVersionQuery(() => query.data.value?.data.version.sourceVersionId ?? '')
const mutations = useObjectMutations(props.productId, props.databaseId)
const data = computed(() => database.data.value?.data)
const version = computed(() => query.data.value?.data.version)
// The version as the database scope lists it (with its revision), for the header and its actions.
const dbVersion = computed(() => data.value?.versions.find((v) => v.id === version.value?.id))
const target = computed(() => product.data.value?.data.product.target ?? 'postgresql18')
const objects = computed(() => (query.data.value?.data.objects ?? []) as DesignObject[])
const changes = computed(() => objectChanges(objects.value, source.data.value?.data.objects ?? []))
const sourceNumber = computed(() => source.data.value?.data.version.number)
const canEdit = computed(
  () =>
    online.value &&
    version.value?.databaseId === props.databaseId &&
    version.value?.status === 'editing' &&
    !!product.data.value &&
    isAllowed(product.data.value.data.role, 'editDesign') &&
    !mutations.save.isPending.value &&
    !mutations.remove.isPending.value,
)
const draft = ref<ObjectInput>()
const draftKey = ref<string>()
const expected = ref<number>()
const baseline = ref('')
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== baseline.value)
useUnsavedChanges(dirty)
const drawer = ref(false)
const common = ref(false)
const deletion = ref(false)
const identity = ref(false)
const adding = ref(false)
const kind = ref<ObjectInput['kind']>('table')
const name = ref('')
const logicalName = ref<string | null>(null)
const schemaKey = ref<string | null>(null)
const localError = ref<unknown>()
const error = computed(() => localError.value ?? mutations.save.error.value)
const ddl = ref('')
const previous = computed(
  () =>
    source.data.value?.data.objects.find((o) => o.objectKey === draftKey.value) as
      | DesignObject
      | undefined,
)
const tab = computed({
  get: () =>
    ['columns', 'constraints', 'indexes', 'size', 'settings', 'ddl'].includes(
      String(route.query.tab),
    )
      ? String(route.query.tab)
      : 'columns',
  set: (value: string) => {
    void router.replace({ query: { ...route.query, tab: value === 'columns' ? undefined : value } })
  },
})
const load = (row: DesignObject) => {
  draft.value = toInput(row)
  draftKey.value = row.objectKey
  expected.value = row.updatedAt
  baseline.value = JSON.stringify(draft.value)
  localError.value = undefined
  mutations.save.reset()
  ddl.value = ''
  mutations.validateView.reset()
}
// Another version: drop the draft of the previous one (leaving with unsaved changes was already
// confirmed by `useUnsavedChanges`), so a save never sends one version's object to another.
watch(
  () => props.versionId,
  (id, old) => {
    if (id === old) return
    draft.value = undefined
    draftKey.value = undefined
    expected.value = undefined
    baseline.value = ''
    ddl.value = ''
  },
)
watch(
  objects,
  (rows) => {
    const row =
      rows.find((o) => o.objectKey === props.objectKey) ??
      (!props.objectKey && !xs.value ? rows.find((o) => o.kind === 'schema') : undefined)
    if (row && !dirty.value) load(row)
  },
  { immediate: true },
)
watch(
  data,
  (scope) => {
    if (!props.versionId && scope?.versions[0])
      void router.replace({
        name: 'design',
        params: {
          productId: props.productId,
          databaseId: props.databaseId,
          versionId: scope.versions[0].id,
        },
      })
  },
  { immediate: true },
)
const select = (key: string) => {
  drawer.value = false
  void router.push({
    name: 'design-object',
    params: {
      productId: props.productId,
      databaseId: props.databaseId,
      versionId: props.versionId,
      objectKey: key,
    },
  })
}
const back = () => {
  void router.push(
    xs.value && props.objectKey
      ? {
          name: 'design',
          params: {
            productId: props.productId,
            databaseId: props.databaseId,
            versionId: props.versionId,
          },
        }
      : { name: 'product', params: { productId: props.productId } },
  )
}
const add = (value: ObjectInput['kind'], schema: string | null) => {
  if (!canEdit.value) return
  kind.value = value
  name.value = ''
  logicalName.value = null
  schemaKey.value =
    value === 'schema' || target.value === 'sqlite3'
      ? null
      : (schema ?? objects.value.find((o) => o.kind === 'schema')?.objectKey ?? null)
  adding.value = true
}
const prepare = () => {
  if (dirty.value && !window.confirm('未保存の変更があります。変更を破棄しますか？')) return
  draft.value = newObject(kind.value, schemaKey.value, target.value)
  draft.value.name = name.value
  draft.value.logicalName = logicalName.value
  draftKey.value = crypto.randomUUID()
  expected.value = undefined
  baseline.value = ''
  adding.value = false
  drawer.value = false
  localError.value = undefined
  mutations.save.reset()
  ddl.value = ''
}
const openIdentity = () => {
  if (!draft.value) return
  name.value = draft.value.name
  logicalName.value = draft.value.logicalName
  schemaKey.value = draft.value.schemaKey
  identity.value = true
}
const applyIdentity = () => {
  if (draft.value) {
    draft.value.name = name.value
    draft.value.logicalName = logicalName.value
    if (draft.value.kind !== 'schema') draft.value.schemaKey = schemaKey.value
  }
  identity.value = false
}
const duplicate = () => {
  if (!draft.value || !draftKey.value || !canEdit.value) return
  if (dirty.value && !window.confirm('未保存の変更を含めて複製しますか？')) return
  const key = crypto.randomUUID()
  draft.value = duplicateObject(draft.value, draftKey.value, key)
  draftKey.value = key
  expected.value = undefined
  baseline.value = ''
  localError.value = undefined
  mutations.save.reset()
  ddl.value = ''
}
const save = async () => {
  if (!draft.value || !draftKey.value || !props.versionId || !canEdit.value) return
  localError.value = undefined
  const input = draft.value
  const fields = inputProblems(input, target.value)
  if (
    utf8ByteLength(JSON.stringify(input.definition)) +
      objects.value
        .filter((o) => o.objectKey !== draftKey.value)
        .reduce((sum, o) => sum + utf8ByteLength(JSON.stringify(o.definition)), 0) >
    LIMITS.versionDefinitionBytes
  )
    localError.value = new ApiError('limit_exceeded', '設計の合計サイズが上限を超えています')
  if (expected.value === undefined && objects.value.length >= LIMITS.objectsPerVersion)
    localError.value = new ApiError('limit_exceeded', 'オブジェクト数が上限に達しています')
  if (Object.keys(fields).length)
    localError.value = new ApiError('invalid_input', '入力内容を確認してください', { fields })
  if (localError.value) return
  try {
    const saved = await mutations.save.mutateAsync({
      versionId: props.versionId,
      objectKey: draftKey.value,
      expectedUpdatedAt: expected.value,
      input,
    })
    load(saved as DesignObject)
    notification.show('オブジェクトを保存しました')
    if (props.objectKey !== saved.objectKey)
      await router.replace({
        name: 'design-object',
        params: {
          productId: props.productId,
          databaseId: props.databaseId,
          versionId: props.versionId,
          objectKey: saved.objectKey,
        },
      })
  } catch {
    /* Mutation exposes errors without replacing the draft. */
  }
}
const reload = async () => {
  if (dirty.value && !window.confirm('未保存の変更を破棄して再読み込みしますか？')) return
  const result = await query.refetch()
  const row = result.data?.data.objects.find((o) => o.objectKey === draftKey.value)
  if (row) load(row as DesignObject)
  else {
    baseline.value = JSON.stringify(draft.value)
    draft.value = undefined
    draftKey.value = undefined
    localError.value = undefined
    mutations.save.reset()
  }
}
const remove = async (confirmationName: string) => {
  if (!props.versionId || !draftKey.value || expected.value === undefined || !canEdit.value) return
  try {
    await mutations.remove.mutateAsync({
      versionId: props.versionId,
      objectKey: draftKey.value,
      expectedUpdatedAt: expected.value,
      confirmationName,
    })
    baseline.value = JSON.stringify(draft.value)
    deletion.value = false
    notification.show('オブジェクトを削除しました')
    await router.replace({
      name: 'design',
      params: {
        productId: props.productId,
        databaseId: props.databaseId,
        versionId: props.versionId,
      },
    })
  } catch {
    /* Keep confirmation open. */
  }
}
const validateView = () => {
  if (
    !props.versionId ||
    !draft.value ||
    !['view', 'materialized_view'].includes(draft.value.kind) ||
    !online.value
  )
    return
  const view = draft.value as Extract<ObjectInput, { kind: 'view' | 'materialized_view' }>
  void mutations.validateView
    .mutateAsync({
      versionId: props.versionId,
      json: {
        objectKey: draftKey.value,
        schemaKey: view.schemaKey,
        select: view.definition.select,
      },
    })
    .catch(() => {})
}
const createDdl = async () => {
  if (!props.versionId || !draft.value || draft.value.kind !== 'table' || !online.value) return
  ddl.value = ''
  try {
    if (version.value?.status === 'editing') {
      const result = await mutations.tableDdl.mutateAsync({
        versionId: props.versionId,
        json: { objectKey: draftKey.value, input: draft.value },
      })
      ddl.value = result.sql
    } else {
      const result = await mutations.ddl.mutateAsync(props.versionId)
      ddl.value = result.steps
        .filter((s) => s.objectKey === draftKey.value)
        .map((s) => s.sql)
        .join('\n\n')
    }
  } catch {
    /* Show API validation beside the preview. */
  }
}
const closeIdentity = () => {
  adding.value = false
  identity.value = false
}
</script>
<template>
  <div class="design-workspace design-screen">
    <OperationError
      :error="database.error.value ?? product.error.value ?? query.error.value"
      @reload="reload"
    /><v-progress-linear v-if="query.isPending.value || database.isPending.value" indeterminate />
    <template v-if="data && version && product.data.value && query.data.value">
      <DbHeader
        v-if="dbVersion"
        :product-id="productId"
        :database-id="databaseId"
        section="design"
        :product-name="product.data.value.data.product.name"
        :target="target"
        :database-name="data.database.name"
        :version="dbVersion"
        :versions="data.versions"
        :back-label="xs && objectKey ? 'オブジェクト一覧に戻る' : undefined"
        @back="back"
      >
        <template #actions>
          <VersionActions
            :product-id="productId"
            :database-id="databaseId"
            :version="dbVersion"
            :versions="data.versions"
            :role="product.data.value.data.role"
            :dirty="dirty"
          >
            <template #before>
              <v-btn variant="outlined" prepend-icon="mdi-file-document-outline" disabled>{{
                mdAndUp ? '定義書PDF' : ''
              }}</v-btn>
            </template>
            <template #after>
              <v-btn
                v-if="draft"
                color="primary"
                :loading="mutations.save.isPending.value"
                :disabled="!canEdit || !dirty"
                @click="save"
                >保存</v-btn
              >
            </template>
            <template #menu>
              <v-list-item
                prepend-icon="mdi-table-column-plus-after"
                title="共通カラム"
                @click="common = true"
              />
              <v-list-item prepend-icon="mdi-file-document-outline" title="定義書PDF" disabled />
            </template>
          </VersionActions>
        </template>
      </DbHeader>
      <p v-if="version.status !== 'editing'" class="readonly-note">
        {{ version.status === 'provisional' ? '仮確定' : '確定' }}バージョンは読み取り専用です。
      </p>
      <div v-if="!mdAndUp && !xs" class="object-breadcrumb">
        <v-btn variant="outlined" prepend-icon="mdi-file-tree-outline" @click="drawer = true"
          >オブジェクト</v-btn
        ><span class="font-mono">{{ draft ? fullName(draft, objects) : '' }}</span>
      </div>
      <div class="design-body">
        <SchemaTree
          v-if="mdAndUp || (xs && !draft)"
          :objects="objects"
          :target="target"
          :selected="draftKey"
          :changes="changes.changes"
          :source-number="sourceNumber"
          :counts="changes"
          :disabled="!canEdit || objects.length >= LIMITS.objectsPerVersion"
          @select="select"
          @add="add"
        />
        <main v-if="draft" class="object-editor">
          <div class="object-header">
            <v-icon v-if="!xs" :icon="kindIcons[draft.kind]" size="20" />
            <div>
              <h1 class="font-mono">
                {{ fullName(draft, objects) || kindLabels[draft.kind] + 'を追加' }}
              </h1>
              <span class="object-logical">{{ draft.logicalName }}</span>
            </div>
            <span
              v-if="sourceNumber !== undefined && changes.changes.get(draftKey ?? '')"
              class="object-change"
              >{{
                changes.changes.get(draftKey ?? '') === 'A'
                  ? '追加'
                  : 'v' + sourceNumber + 'から変更'
              }}</span
            ><span
              v-if="draft.kind === 'table' && draft.definition.options.strict"
              class="constraint-tag"
              >STRICT</span
            ><v-spacer /><v-btn
              v-if="!xs && draft.kind !== 'schema'"
              icon="mdi-content-copy"
              variant="text"
              size="small"
              :disabled="!canEdit"
              aria-label="オブジェクトを複製"
              @click="duplicate"
            /><v-menu
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  size="small"
                  aria-label="オブジェクトの操作" /></template
              ><v-list
                ><v-list-item
                  title="名前・スキーマを変更"
                  :disabled="!canEdit"
                  @click="openIdentity" /><v-list-item
                  v-if="draft.kind !== 'schema'"
                  title="複製"
                  :disabled="!canEdit"
                  @click="duplicate" /><v-list-item
                  title="削除"
                  :disabled="
                    !canEdit ||
                    expected === undefined ||
                    (draft.kind === 'schema' && objects.some((o) => o.schemaKey === draftKey))
                  "
                  @click="deletion = true" /></v-list
            ></v-menu>
          </div>
          <div v-if="error" class="object-errors">
            <OperationError :error="error" @reload="reload" /><template
              v-if="error instanceof ApiError"
              ><p
                v-for="[path, message] in Object.entries(error.fields ?? {})"
                :key="path"
                class="field-error"
              >
                {{ fieldLabel(path, draft) }}: {{ message }}
              </p></template
            >
          </div>
          <TableEditor
            v-if="draft.kind === 'table'"
            :key="draftKey"
            v-model="draft.definition"
            v-model:tab="tab"
            :target="target"
            :disabled="!canEdit"
            :objects="objects"
            :common-columns="data.commonColumns"
            :previous="previous?.kind === 'table' ? previous.definition : undefined"
            :source-number="sourceNumber"
            :error="error"
            :ddl="ddl"
            :ddl-pending="mutations.tableDdl.isPending.value || mutations.ddl.isPending.value"
            :ddl-error="mutations.tableDdl.error.value ?? mutations.ddl.error.value"
            @common="common = true"
            @identity="openIdentity"
            @ddl="createDdl"
          />
          <template v-else>
            <SchemaEditor
              v-if="draft.kind === 'schema'"
              v-model="draft.definition"
              :schema-key="draftKey!"
              :objects="objects"
              :target="target"
              :disabled="!canEdit"
              :changes="changes.changes"
              @select="select"
              @remove="deletion = true"
              @add="add('table', draftKey ?? null)"
              ><template #identity
                ><ObjectNames
                  v-model:name="draft.name"
                  v-model:logical-name="draft.logicalName"
                  :disabled="!canEdit"
                  :error="error" /></template></SchemaEditor
            ><SequenceEditor
              v-else-if="draft.kind === 'sequence'"
              v-model="draft.definition"
              :objects="objects"
              :name="draft.name"
              :schema-key="draft.schemaKey"
              :disabled="!canEdit"
              :error="error"
              ><template #identity
                ><ObjectNames
                  v-model:name="draft.name"
                  v-model:logical-name="draft.logicalName"
                  :disabled="!canEdit"
                  :error="error" /></template></SequenceEditor
            ><ViewEditor
              v-else
              v-model="draft.definition"
              :kind="draft.kind"
              :target="target"
              :disabled="!canEdit"
              :objects="objects"
              :analysis="mutations.validateView.data.value"
              :pending="mutations.validateView.isPending.value"
              :error="mutations.validateView.error.value"
              @kind="draft.kind = $event"
              @validate="validateView"
          /></template>
          <div v-if="xs" class="object-save phone-fixed">
            <span>{{ dirty ? '未保存の変更があります' : '保存済み' }}</span
            ><v-btn
              color="primary"
              :disabled="!canEdit || !dirty"
              :loading="mutations.save.isPending.value"
              @click="save"
              >保存</v-btn
            >
          </div>
        </main>
        <div v-else-if="!xs" class="empty-design editor-empty">
          オブジェクトを選択してください<v-btn
            v-if="!mdAndUp"
            variant="outlined"
            class="mt-4"
            @click="drawer = true"
            >オブジェクトを表示</v-btn
          >
        </div>
      </div>
      <v-navigation-drawer v-if="!mdAndUp && !xs" v-model="drawer" temporary width="300"
        ><SchemaTree
          :objects="objects"
          :target="target"
          :selected="draftKey"
          :changes="changes.changes"
          :source-number="sourceNumber"
          :counts="changes"
          :disabled="!canEdit"
          @select="select"
          @add="add"
      /></v-navigation-drawer>
      <CommonColumnsDialog
        v-if="common"
        v-model="common"
        :product-id="productId"
        :database-id="databaseId"
        :target="target"
      />
      <DeleteDialog
        v-if="deletion && draft"
        v-model="deletion"
        :name="draft.name"
        :kind="kindLabels[draft.kind]"
        detail="参照元の定義は自動では変更されません。削除後に参照を確認してください。"
        :pending="mutations.remove.isPending.value"
        :error="mutations.remove.error.value"
        @confirm="remove"
        @reload="reload"
      />
      <v-dialog
        :model-value="adding || identity"
        class="design-dialog"
        :class="{ 'bottom-sheet-dialog': xs }"
        max-width="520"
        @update:model-value="closeIdentity"
        ><v-card
          ><v-card-title>{{
            adding ? kindLabels[kind] + 'を追加' : '名前・スキーマを変更'
          }}</v-card-title
          ><v-card-text class="design-fields"
            ><DesignField v-model="name" label="物理名" required /><DesignField
              v-model="logicalName"
              label="論理名"
              :mono="false" /><DesignField
              v-if="target === 'postgresql18' && (adding ? kind : draft?.kind) !== 'schema'"
              v-model="schemaKey"
              label="スキーマ"
              :items="
                objects
                  .filter((o) => o.kind === 'schema')
                  .map((o) => ({ title: o.name, value: o.objectKey }))
              " /></v-card-text
          ><v-card-actions
            ><v-btn variant="text" @click="closeIdentity">キャンセル</v-btn
            ><v-btn
              color="primary"
              variant="flat"
              :disabled="
                !canEdit ||
                !name?.trim() ||
                ((adding ? kind : draft?.kind) !== 'schema' &&
                  target === 'postgresql18' &&
                  !schemaKey)
              "
              @click="adding ? prepare() : applyIdentity()"
              >{{ adding ? '設計を開始' : '変更する' }}</v-btn
            ></v-card-actions
          ></v-card
        ></v-dialog
      >
    </template>
    <v-alert
      v-else-if="!query.isPending.value && !database.isPending.value && !query.error.value"
      type="error"
      variant="tonal"
      >対象のバージョンが見つかりません</v-alert
    >
  </div>
</template>
