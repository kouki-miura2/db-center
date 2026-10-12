<script setup lang="ts">
import { formatDate, isAllowed } from 'utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import OperationError from '../components/common/OperationError.vue'
import DbHeader from '../components/database/DbHeader.vue'
import VersionChip from '../components/database/VersionChip.vue'
import NewVersionDialog from '../components/version/NewVersionDialog.vue'
import VersionActions from '../components/version/VersionActions.vue'
import { useDatabaseQuery } from '../composables/useDatabaseQuery.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'

// The version history (design 4j 5j 6j): newest first ("各論 > データベース > 一覧"), with where
// each version was applied, and a new version from a final one.
const props = defineProps<{ productId: string; databaseId: string }>()
const router = useRouter()
const { xs } = useDisplay()
const online = useOnline()
const database = useDatabaseQuery(props.productId, props.databaseId)
const product = useProductQuery(props.productId)
const data = computed(() => database.data.value?.data)
const role = computed(() => product.data.value?.data.role)
const creating = ref(false)

const dateTime = (value: number | null) =>
  value === null ? '—' : formatDate(new Date(value), 'yyyy/MM/dd HH:mm')
const numberOf = (versionId: string | null) =>
  data.value?.versions.find((v) => v.id === versionId)?.number
/** The connections each version was last built or migrated to successfully. */
const appliedTo = computed(() => {
  const applied = new Map<string, Set<string>>()
  for (const deployment of data.value?.deployments ?? []) {
    if (deployment.status !== 'succeeded') continue
    const names = applied.get(deployment.toVersionId) ?? new Set<string>()
    names.add(deployment.connectionName)
    applied.set(deployment.toVersionId, names)
  }
  return (versionId: string) => [...(applied.get(versionId) ?? [])].join(' ・ ') || '—'
})
const canCreate = computed(
  () =>
    !!role.value &&
    isAllowed(role.value, 'createVersion') &&
    !!data.value?.versions.every((v) => v.status === 'final'),
)

const openDesign = (versionId: string) =>
  router.push({
    name: 'design',
    params: { productId: props.productId, databaseId: props.databaseId, versionId },
  })
</script>

<template>
  <div class="design-workspace design-screen">
    <OperationError
      :error="database.error.value ?? product.error.value"
      @reload="database.refetch()"
    />
    <v-progress-linear
      v-if="database.isPending.value || product.isPending.value"
      indeterminate
      color="primary"
      aria-label="読み込み中"
    />
    <template v-if="data && data.versions[0] && product.data.value && role">
      <DbHeader
        :product-id="productId"
        :database-id="databaseId"
        section="history"
        :product-name="product.data.value.data.product.name"
        :target="product.data.value.data.product.target"
        :database-name="data.database.name"
        :version="data.versions[0]"
        :versions="data.versions"
      >
        <template #actions>
          <VersionActions
            :product-id="productId"
            :database-id="databaseId"
            :version="data.versions[0]"
            :versions="data.versions"
            :role="role"
          />
        </template>
      </DbHeader>
      <v-container class="page">
        <div class="screen-header">
          <div>
            <h1 class="screen-title">バージョン履歴</h1>
            <p class="screen-caption">{{ data.versions.length }}件</p>
          </div>
          <v-spacer />
          <v-btn
            v-if="canCreate"
            color="primary"
            prepend-icon="mdi-plus"
            :disabled="!online"
            @click="creating = true"
            >新しいバージョンを作成</v-btn
          >
        </div>
        <div v-if="xs" class="d-flex flex-column ga-3">
          <v-card v-for="v in data.versions" :key="v.id" class="pa-4" @click="openDesign(v.id)">
            <div class="d-flex align-center ga-2 mb-2">
              <VersionChip :version="v" />
              <v-spacer />
              <v-icon size="18" color="medium-emphasis">mdi-chevron-right</v-icon>
            </div>
            <p v-if="v.memo" class="text-body-2 mb-1">{{ v.memo }}</p>
            <p class="screen-caption font-mono">
              確定 {{ dateTime(v.finalizedAt) }} ・ {{ appliedTo(v.id) }}
            </p>
          </v-card>
        </div>
        <v-card v-else>
          <v-table class="design-table">
            <thead>
              <tr>
                <th>バージョン</th>
                <th>作成元</th>
                <th>メモ</th>
                <th>仮確定</th>
                <th>確定</th>
                <th>適用環境</th>
                <th />
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in data.versions" :key="v.id" @click="openDesign(v.id)">
                <td><VersionChip :version="v" /></td>
                <td class="font-mono">
                  {{ numberOf(v.sourceVersionId) ? `v${numberOf(v.sourceVersionId)}` : '—' }}
                </td>
                <td class="text-body-2">{{ v.memo ?? '' }}</td>
                <td class="font-mono text-caption">{{ dateTime(v.provisionalAt) }}</td>
                <td class="font-mono text-caption">{{ dateTime(v.finalizedAt) }}</td>
                <td class="text-caption">{{ appliedTo(v.id) }}</td>
                <td>
                  <v-btn
                    icon="mdi-pencil-ruler"
                    variant="text"
                    size="small"
                    :aria-label="`v${v.number} の設計を開く`"
                    @click.stop="openDesign(v.id)"
                  />
                </td>
              </tr>
            </tbody>
          </v-table>
        </v-card>
      </v-container>
      <NewVersionDialog
        v-if="creating"
        v-model="creating"
        :product-id="productId"
        :database-id="databaseId"
        :versions="data.versions"
        @done="openDesign"
      />
    </template>
  </div>
</template>
