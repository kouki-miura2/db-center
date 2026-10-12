<script setup lang="ts">
import { formatDate, isAllowed, LIMITS } from 'utils'
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import { succeeded } from '../../api/call.ts'
import { useDatabaseMutations } from '../../composables/useDatabaseMutations.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useProductQuery, type ProductData } from '../../composables/useProductQuery.ts'
import DeleteDialog from '../common/DeleteDialog.vue'
import CommonColumnsDialog from './CommonColumnsDialog.vue'
import DatabaseFormDialog from './DatabaseFormDialog.vue'
import VersionChip from './VersionChip.vue'
const props = defineProps<{ productId: string; data: ProductData }>()
const creating = defineModel<boolean>('creating', { default: false })
const { xs } = useDisplay()
const online = useOnline()
const query = useProductQuery(props.productId)
const mutation = useDatabaseMutations(props.productId)
const selected = ref<{ id: string; kind: 'edit' | 'delete' | 'common' } | null>(null)
const deletionTarget = ref<ProductData['databases'][number]>()
const openDelete = (database: ProductData['databases'][number]) => {
  deletionTarget.value = { ...database }
  selected.value = { id: database.id, kind: 'delete' }
  mutation.remove.reset()
}
const reloadDeletion = async () => {
  await query.refetch()
  if (current.value) deletionTarget.value = { ...current.value }
  mutation.remove.reset()
}
const current = computed(() => props.data.databases.find((row) => row.id === selected.value?.id))
const manage = computed(() => isAllowed(props.data.role, 'manageDatabases'))
const databases = computed(() =>
  props.data.databases.toSorted((a, b) => a.name.localeCompare(b.name)),
)
const remove = async (confirmationName: string) => {
  if (!deletionTarget.value) return
  if (
    await succeeded(
      mutation.remove.mutateAsync({
        databaseId: deletionTarget.value.id,
        json: { confirmationName, expectedUpdatedAt: deletionTarget.value.updatedAt },
      }),
    )
  )
    selected.value = null
}
const close = (value: boolean) => {
  if (!value) selected.value = null
}
</script>
<template>
  <div class="d-flex align-center ga-3 mb-4">
    <h2 class="text-subtitle-1 font-weight-bold">データベース</h2>
    <v-chip>{{ databases.length }} / {{ LIMITS.databasesPerProduct }}</v-chip
    ><v-spacer /><v-btn
      v-if="manage && !xs"
      color="primary"
      prepend-icon="mdi-plus"
      :disabled="!online || databases.length >= LIMITS.databasesPerProduct"
      @click="creating = true"
      >データベースを作成</v-btn
    >
  </div>
  <v-card v-if="!databases.length" class="pa-8 text-center"
    ><v-icon size="40" color="primary" class="mb-3">mdi-database-outline</v-icon>
    <p class="text-subtitle-2 mb-2">データベースはまだありません</p>
    <p class="text-caption text-medium-emphasis">
      データベースを作成して設計を始めましょう。
    </p></v-card
  >
  <div v-else-if="xs" class="d-flex flex-column ga-3">
    <v-card v-for="database in databases" :key="database.id"
      ><v-card-text>
        <div class="d-flex align-center ga-2 mb-3">
          <v-icon color="primary">mdi-database-outline</v-icon
          ><router-link
            class="font-mono font-weight-bold flex-grow-1 text-break"
            :to="{ name: 'database', params: { productId, databaseId: database.id } }"
            >{{ database.name }}</router-link
          ><v-btn
            icon="mdi-dots-vertical"
            variant="text"
            size="small"
            :aria-label="`${database.name}の操作`"
            ><v-menu activator="parent"
              ><v-list density="compact"
                ><v-list-item
                  title="共通カラムのセット"
                  @click="selected = { id: database.id, kind: 'common' }" /><v-list-item
                  v-if="manage"
                  title="名前・説明を変更"
                  :disabled="!online"
                  @click="selected = { id: database.id, kind: 'edit' }" /><v-list-item
                  v-if="manage"
                  title="削除"
                  base-color="error"
                  :disabled="!online"
                  @click="openDelete(database)" /></v-list></v-menu
          ></v-btn>
        </div>
        <p class="text-caption text-medium-emphasis mb-3">
          {{
            data.product.target === 'postgresql18' ? `スキーマ ${database.schemaCount} · ` : ''
          }}テーブル {{ database.tableCount }}
        </p>
        <VersionChip :version="database.latestVersion" /><span class="ml-2 text-caption"
          >確定
          {{ database.latestFinalVersion ? `v${database.latestFinalVersion.number}` : '—' }}</span
        >
        <p class="text-caption text-medium-emphasis mt-3 font-mono">
          更新 {{ formatDate(new Date(database.updatedAt), 'yyyy/MM/dd HH:mm') }}
        </p>
      </v-card-text></v-card
    >
  </div>
  <v-card v-else
    ><v-table
      ><thead>
        <tr>
          <th>データベース名</th>
          <th>最新バージョン</th>
          <th>確定済み</th>
          <th>更新日時</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="database in databases" :key="database.id">
          <td class="py-3">
            <router-link
              class="font-mono font-weight-bold"
              :to="{ name: 'database', params: { productId, databaseId: database.id } }"
              >{{ database.name }}</router-link
            >
            <p class="text-caption text-medium-emphasis mt-1">
              {{
                data.product.target === 'postgresql18' ? `スキーマ ${database.schemaCount} · ` : ''
              }}テーブル {{ database.tableCount }}
            </p>
          </td>
          <td><VersionChip :version="database.latestVersion" /></td>
          <td class="font-mono text-body-2">
            {{ database.latestFinalVersion ? `v${database.latestFinalVersion.number}` : '—' }}
          </td>
          <td class="font-mono text-caption">
            {{ formatDate(new Date(database.updatedAt), 'yyyy/MM/dd HH:mm') }}
          </td>
          <td>
            <v-btn
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              :aria-label="`${database.name}の操作`"
              ><v-menu activator="parent"
                ><v-list density="compact"
                  ><v-list-item
                    title="共通カラムのセット"
                    @click="selected = { id: database.id, kind: 'common' }" /><v-list-item
                    v-if="manage"
                    title="名前・説明を変更"
                    :disabled="!online"
                    @click="selected = { id: database.id, kind: 'edit' }" /><v-list-item
                    v-if="manage"
                    title="削除"
                    base-color="error"
                    :disabled="!online"
                    @click="openDelete(database)" /></v-list></v-menu
            ></v-btn>
          </td>
        </tr></tbody></v-table
  ></v-card>
  <DatabaseFormDialog
    v-if="creating && manage"
    v-model="creating"
    :product-id="productId"
    :databases="data.databases"
  />
  <DatabaseFormDialog
    v-if="selected?.kind === 'edit' && current && manage"
    :key="current.id"
    :model-value="true"
    :product-id="productId"
    :databases="data.databases"
    :database="current"
    @update:model-value="close"
  />
  <DeleteDialog
    v-if="selected?.kind === 'delete' && deletionTarget && manage"
    :model-value="true"
    :name="deletionTarget.name"
    kind="データベース"
    detail="すべてのバージョン・設計・実行履歴が削除されます。"
    :pending="mutation.remove.isPending.value"
    :error="mutation.remove.error.value"
    @update:model-value="close"
    @confirm="remove"
    @reload="reloadDeletion"
  />
  <CommonColumnsDialog
    v-if="selected?.kind === 'common' && current"
    :model-value="true"
    :product-id="productId"
    :database-id="current.id"
    :target="data.product.target"
    @update:model-value="close"
  />
</template>
