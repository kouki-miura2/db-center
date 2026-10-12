<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { isAllowed, LIMITS, TARGETS, type Target } from 'utils'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import { succeeded } from '../api/call.ts'
import { scopeKeys, type Scope } from '../cache/scope.ts'
import DeleteDialog from '../components/common/DeleteDialog.vue'
import OperationError from '../components/common/OperationError.vue'
import ConnectionFields from '../components/product/ConnectionFields.vue'
import { useOnline } from '../composables/useOnline.ts'
import { useProductMutations } from '../composables/useProductMutations.ts'
import {
  useProductQuery,
  type ProductData,
  type Connection,
} from '../composables/useProductQuery.ts'
import { useUnsavedChanges } from '../composables/useUnsavedChanges.ts'
import {
  connectionDraft,
  connectionChanged,
  connectionInput,
  type ConnectionDraft,
} from '../forms/connections.ts'
import { fieldError, maxLength, required } from '../forms/input.ts'
import { useNotificationStore } from '../stores/notification.ts'

const props = defineProps<{ productId?: string }>()
const editing = !!props.productId
const client = useQueryClient()
const query = useProductQuery(props.productId ?? '')
// Creation has no product scope to read yet.
const router = useRouter()
const online = useOnline()
const notification = useNotificationStore()
const name = ref('')
const target = ref<Target>('postgresql18')
const rows = ref<ConnectionDraft[]>([])
const deleted = ref<Connection[]>([])
const baseline = ref('')
const savedProduct = ref<ProductData['product'] | null>(null)
const createdId = ref<string>()
const mutation = useProductMutations(() => props.productId ?? createdId.value ?? '')
const error = ref<unknown>(null)
const errorKey = ref('')
const saving = ref(false)
const valid = ref(false)
const deleting = ref(false)
const canEdit = computed(
  () => !editing || (!!query.data.value && isAllowed(query.data.value.data.role, 'renameProduct')),
)
const snapshot = () =>
  JSON.stringify({
    name: name.value,
    target: target.value,
    rows: rows.value,
    deleted: deleted.value,
  })
const dirty = computed(() => baseline.value !== '' && snapshot() !== baseline.value)
useUnsavedChanges(dirty)
const load = () => {
  const data = query.data.value?.data
  if (!data) return
  name.value = data.product.name
  target.value = data.product.target
  savedProduct.value = data.product
  rows.value = data.connections.map(connectionDraft)
  deleted.value = []
  error.value = null
  baseline.value = snapshot()
}
watch(
  query.data,
  () => {
    if (editing && baseline.value === '') load()
  },
  { immediate: true },
)
if (!editing) baseline.value = snapshot()
const reload = async () => {
  await query.refetch()
  load()
}
const removeConnection = (row: ConnectionDraft) => {
  if (row.saved && !window.confirm(`接続情報「${row.name}」を削除しますか？`)) return
  if (row.saved) deleted.value.push(row.saved)
  rows.value = rows.value.filter((candidate) => candidate.key !== row.key)
}
const save = async () => {
  if (!valid.value || !online.value || !canEdit.value) return
  saving.value = true
  error.value = null
  errorKey.value = ''
  try {
    let id = props.productId ?? createdId.value
    if (!id) {
      const product = await mutation.create.mutateAsync({
        name: name.value.trim(),
        target: target.value,
      })
      id = product.id
      createdId.value = id
      savedProduct.value = product
    } else if (savedProduct.value && name.value.trim() !== savedProduct.value.name) {
      // A partial registration keeps its ID so retrying cannot create a second product.
      if (editing)
        savedProduct.value = await mutation.rename.mutateAsync({
          name: name.value.trim(),
          expectedUpdatedAt: savedProduct.value.updatedAt,
        })
    }
    for (const connection of deleted.value) {
      await mutation.deleteConnection.mutateAsync({
        connectionId: connection.id,
        expectedUpdatedAt: connection.updatedAt,
      })
      deleted.value = deleted.value.filter((row) => row.id !== connection.id)
    }
    if (target.value === 'postgresql18')
      for (const row of rows.value) {
        errorKey.value = row.key
        if (!connectionChanged(row)) continue
        const json = connectionInput(row)
        const saved = row.saved
          ? await mutation.editConnection.mutateAsync({
              connectionId: row.saved.id,
              json: { ...json, expectedUpdatedAt: row.saved.updatedAt },
            })
          : await mutation.addConnection.mutateAsync({
              productId: id,
              json: { ...json, password: row.password || undefined },
            })
        row.saved = saved
        row.key = saved.id
        row.password = ''
        row.removePassword = false
      }
    if (editing) {
      const scope = client.getQueryData<Scope<ProductData>>(scopeKeys.product(id))
      const order = rows.value.map((row) => row.saved?.id ?? '')
      if (scope && order.join() !== scope.data.connections.map((row) => row.id).join())
        await mutation.reorder.mutateAsync({
          connectionIds: order,
          expectedRevision: scope.revision,
        })
    }
    baseline.value = snapshot()
    notification.show('プロダクトを保存しました')
    await router.push({ name: 'product', params: { productId: id } })
  } catch (cause) {
    error.value = cause
  } finally {
    saving.value = false
  }
}
const confirmDelete = async (confirmationName: string) => {
  if (!savedProduct.value) return
  if (
    await succeeded(
      mutation.remove.mutateAsync({
        confirmationName,
        expectedUpdatedAt: savedProduct.value.updatedAt,
      }),
    )
  ) {
    baseline.value = snapshot()
    notification.show('プロダクトを削除しました')
    await router.replace({ name: 'products' })
  }
}
</script>
<template>
  <v-container class="page form-page">
    <h1 class="text-h5 font-weight-bold mb-2">
      {{ editing ? 'プロダクトを編集' : 'プロダクトを登録' }}
    </h1>
    <p class="text-body-2 text-medium-emphasis mb-6">
      プロダクトごとにデータベース設計と参加者を管理します。
    </p>
    <OperationError :error="error ?? (editing ? query.error.value : null)" @reload="reload" />
    <v-progress-linear v-if="editing && query.isPending.value" indeterminate />
    <v-alert
      v-else-if="editing && !canEdit"
      type="warning"
      variant="tonal"
      text="プロダクトを編集する権限がありません"
    />
    <v-form v-else v-model="valid" @submit.prevent="save">
      <v-card class="mb-5"
        ><v-card-text class="pa-5">
          <h2 class="text-subtitle-1 font-weight-bold mb-4">基本情報</h2>
          <v-text-field
            v-model="name"
            label="プロダクト名 *"
            :rules="[required, maxLength(LIMITS.productNameMaxLength)]"
            :error-messages="fieldError(error, 'name')"
            :disabled="!online || saving || !!createdId"
          />
          <v-select
            v-model="target"
            :items="Object.entries(TARGETS).map(([value, item]) => ({ value, title: item.label }))"
            label="ターゲット *"
            :disabled="editing || !online || saving || !!createdId"
            hint="登録後はターゲットを変更できません"
            persistent-hint
          /> </v-card-text
      ></v-card>
      <v-card v-if="target === 'postgresql18'" class="mb-5"
        ><v-card-text class="pa-5"
          ><ConnectionFields
            v-model="rows"
            :disabled="!online || saving"
            :error="error"
            :error-key="errorKey"
            @remove="removeConnection" /></v-card-text
      ></v-card>
      <v-alert v-if="createdId && error" type="warning" variant="tonal" class="mb-4"
        >プロダクトの登録は完了しています。接続情報を修正して再度保存すると、続きから登録します。</v-alert
      >
      <div class="d-flex justify-end ga-2">
        <v-btn
          :to="editing ? { name: 'product', params: { productId } } : { name: 'products' }"
          variant="outlined"
          :disabled="saving"
          >キャンセル</v-btn
        ><v-btn
          type="submit"
          color="primary"
          :loading="saving"
          :disabled="!online || !valid || !canEdit"
          >{{ editing ? '変更を保存' : createdId ? '接続情報の登録を続ける' : '登録する' }}</v-btn
        >
      </div>
    </v-form>
    <v-card v-if="editing && query.data.value?.data.role === 'owner'" class="mt-8" border="error sm"
      ><v-card-text>
        <h2 class="text-subtitle-1 font-weight-bold text-error mb-2">プロダクトの削除</h2>
        <p class="text-body-2 mb-4">すべてのデータベース・設計・接続情報が削除されます。</p>
        <v-btn
          color="error"
          variant="outlined"
          :disabled="!online || saving"
          @click="deleting = true"
          >プロダクトを削除</v-btn
        >
      </v-card-text></v-card
    >
    <DeleteDialog
      v-if="deleting && savedProduct"
      v-model="deleting"
      kind="プロダクト"
      :name="savedProduct.name"
      :detail="`データベース ${query.data.value?.data.databases.length ?? 0}件、参加者 ${query.data.value?.data.members.length ?? 0}名と配下のデータを削除します。`"
      :pending="mutation.remove.isPending.value"
      :error="mutation.remove.error.value"
      @confirm="confirmDelete"
      @reload="reload"
    />
  </v-container>
</template>
