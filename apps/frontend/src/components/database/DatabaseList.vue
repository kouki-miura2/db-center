<script setup lang="ts">
import { formatDate, isAllowed } from 'utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
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
const { xs, sm } = useDisplay()
const router = useRouter()
const select = (databaseId: string) =>
  router.push({ name: 'database', params: { productId: props.productId, databaseId } })
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
  <v-card v-if="!databases.length" class="pa-8 text-center"
    ><v-icon size="40" color="primary" class="mb-3">mdi-database-outline</v-icon>
    <h2 class="mb-2">データベースはまだありません</h2>
    <p class="screen-caption">データベースを作成して設計を始めましょう。</p></v-card
  >
  <div v-else-if="xs" class="d-flex flex-column ga-3">
    <v-card v-for="database in databases" :key="database.id" class="database-mobile-card">
      <router-link
        class="database-card-link"
        :to="{ name: 'database', params: { productId, databaseId: database.id } }"
        ><div class="d-flex align-center ga-2 mb-2">
          <span class="font-mono font-weight-bold">{{ database.name }}</span
          ><VersionChip :version="database.latestVersion" combined />
        </div>
        <p class="screen-caption">
          {{
            database.latestFinalVersion
              ? '確定 v' + database.latestFinalVersion.number + ' ・ '
              : ''
          }}テーブル {{ database.tableCount }} ・
          <span class="font-mono">{{
            formatDate(new Date(database.updatedAt), 'yyyy/MM/dd HH:mm')
          }}</span>
        </p></router-link
      >
      <div class="database-card-menu">
        <v-menu
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              variant="text"
              size="small"
              :aria-label="database.name + 'の操作'"
              @click.stop /></template
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
              @click="openDelete(database)" /></v-list
        ></v-menu>
      </div>
    </v-card>
  </div>
  <v-card v-else
    ><v-table class="design-table database-table"
      ><thead>
        <tr>
          <th>データベース名</th>
          <th>{{ sm ? '最新 / 確定済み' : '最新バージョン' }}</th>
          <th v-if="!sm">確定済み</th>
          <th>更新日時</th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="database in databases" :key="database.id" @click="select(database.id)">
          <td>
            <router-link
              class="row-link font-mono"
              :to="{ name: 'database', params: { productId, databaseId: database.id } }"
              @click.stop
              >{{ database.name }}</router-link
            >
            <p class="screen-caption mt-1">
              {{
                data.product.target === 'postgresql18'
                  ? 'スキーマ ' + database.schemaCount + ' ・ '
                  : ''
              }}テーブル {{ database.tableCount }}
            </p>
          </td>
          <td>
            <VersionChip :version="database.latestVersion" :combined="sm" />
            <p v-if="sm" class="screen-caption mt-1 font-mono">
              確定
              {{ database.latestFinalVersion ? 'v' + database.latestFinalVersion.number : '—' }}
            </p>
          </td>
          <td v-if="!sm" class="font-mono">
            {{ database.latestFinalVersion ? 'v' + database.latestFinalVersion.number : '—' }}
          </td>
          <td class="font-mono text-body-small">
            {{ formatDate(new Date(database.updatedAt), 'yyyy/MM/dd HH:mm') }}
          </td>
          <td>
            <v-menu
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  size="small"
                  :aria-label="database.name + 'の操作'"
                  @click.stop /></template
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
                  @click="openDelete(database)" /></v-list
            ></v-menu>
          </td>
        </tr></tbody></v-table
  ></v-card>
  <p v-if="!xs && databases.length" class="table-note">
    ⋮ メニュー：名前の変更・削除（オーナー・マネージャーのみ）
  </p>
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
