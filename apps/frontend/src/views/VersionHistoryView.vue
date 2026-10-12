<script setup lang="ts">
import { formatDate, isAllowed } from 'utils'
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import DatabasePage from '../components/database/DatabasePage.vue'
import VersionChip from '../components/database/VersionChip.vue'
import DeploymentProgress from '../components/deployment/DeploymentProgress.vue'
import DefinitionExportDialog from '../components/version/DefinitionExportDialog.vue'
import NewVersionDialog from '../components/version/NewVersionDialog.vue'
import type { DatabaseData } from '../composables/useDatabaseQuery.ts'
import { useOnline } from '../composables/useOnline.ts'

// The version history (design 4j 5j 6j): newest first ("各論 > データベース > 一覧"), with where
// each version was applied, and a new version from a final one. Below it, the automatic builds and
// migrations, newest first, each opening its progress and log ("データ仕様 > deployments").
const props = defineProps<{ productId: string; databaseId: string }>()
const router = useRouter()
const { xs } = useDisplay()
const online = useOnline()
const creating = ref(false)
const exporting = ref<DatabaseData['versions'][number]>()
const shownDeployment = ref<string>()
const STATUS = { running: '実行中', succeeded: '成功', failed: '失敗' } as const
const STATUS_COLORS = { running: 'info', succeeded: 'success', failed: 'error' } as const
const versionsOf = (database: DatabaseData, d: DatabaseData['deployments'][number]) =>
  d.fromVersionId
    ? `v${numberOf(database, d.fromVersionId) ?? '?'} → v${numberOf(database, d.toVersionId) ?? '?'}`
    : `v${numberOf(database, d.toVersionId) ?? '?'}`
const dateTime = (value: number | null) =>
  value === null ? '—' : formatDate(new Date(value), 'yyyy/MM/dd HH:mm')
const numberOf = (database: DatabaseData, versionId: string | null) =>
  database.versions.find((v) => v.id === versionId)?.number
/** The connections a version was built or migrated to successfully. */
const appliedTo = (database: DatabaseData, versionId: string) =>
  [
    ...new Set(
      database.deployments
        .filter((d) => d.status === 'succeeded' && d.toVersionId === versionId)
        .map((d) => d.connectionName),
    ),
  ].join(' ・ ') || '—'
const canCreate = (database: DatabaseData, role: Parameters<typeof isAllowed>[0]) =>
  isAllowed(role, 'createVersion') && database.versions.every((v) => v.status === 'final')

const params = { productId: props.productId, databaseId: props.databaseId }
const openDesign = (versionId: string) =>
  router.push({ name: 'design', params: { ...params, versionId } })
const openDiff = (database: DatabaseData, versionId: string) => {
  const from = database.versions.find((v) => v.id === versionId)?.sourceVersionId
  void router.push({
    name: 'database-migration',
    params,
    query: { from: from ?? undefined, to: versionId },
  })
}
</script>

<template>
  <DatabasePage
    v-slot="{ database, product }"
    :product-id="productId"
    :database-id="databaseId"
    section="history"
  >
    <div class="screen-header">
      <div>
        <h1 class="screen-title">バージョン履歴</h1>
        <p class="screen-caption">{{ database.versions.length }}件</p>
      </div>
      <v-spacer />
      <v-btn
        v-if="canCreate(database, product.role)"
        color="primary"
        prepend-icon="mdi-plus"
        :disabled="!online"
        @click="creating = true"
        >新しいバージョンを作成</v-btn
      >
    </div>
    <div v-if="xs" class="d-flex flex-column ga-3">
      <v-card v-for="v in database.versions" :key="v.id" class="pa-4" @click="openDesign(v.id)">
        <div class="d-flex align-center ga-2 mb-2">
          <VersionChip :version="v" />
          <v-spacer />
          <v-icon size="18" color="medium-emphasis">mdi-chevron-right</v-icon>
        </div>
        <p v-if="v.memo" class="text-body-medium mb-1">{{ v.memo }}</p>
        <p class="screen-caption font-mono">
          確定 {{ dateTime(v.finalizedAt) }} ・ {{ appliedTo(database, v.id) }}
        </p>
        <div class="d-flex flex-wrap ga-2 mt-3">
          <v-btn
            v-if="v.status !== 'editing' && v.sourceVersionId"
            variant="outlined"
            size="small"
            prepend-icon="mdi-vector-difference"
            :aria-label="`v${v.number} の差分`"
            @click.stop="openDiff(database, v.id)"
            >差分</v-btn
          >
          <v-btn
            variant="outlined"
            size="small"
            prepend-icon="mdi-file-document-outline"
            :aria-label="`v${v.number} の定義書を出力`"
            :disabled="!online"
            @click.stop="exporting = v"
            >定義書</v-btn
          >
        </div>
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
          <tr v-for="v in database.versions" :key="v.id" @click="openDesign(v.id)">
            <td><VersionChip :version="v" /></td>
            <td class="font-mono">
              {{
                numberOf(database, v.sourceVersionId)
                  ? `v${numberOf(database, v.sourceVersionId)}`
                  : '—'
              }}
            </td>
            <td class="text-body-medium">{{ v.memo ?? '' }}</td>
            <td class="font-mono text-body-small">{{ dateTime(v.provisionalAt) }}</td>
            <td class="font-mono text-body-small">{{ dateTime(v.finalizedAt) }}</td>
            <td class="text-body-small">{{ appliedTo(database, v.id) }}</td>
            <td class="text-no-wrap">
              <v-btn
                v-if="v.status !== 'editing' && v.sourceVersionId"
                icon="mdi-vector-difference"
                variant="text"
                size="small"
                :aria-label="`v${v.number} の差分`"
                @click.stop="openDiff(database, v.id)"
              />
              <v-btn
                icon="mdi-file-document-outline"
                variant="text"
                size="small"
                :aria-label="`v${v.number} の定義書を出力`"
                :title="`v${v.number} の定義書を出力`"
                :disabled="!online"
                @click.stop="exporting = v"
              />
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
    <template v-if="database.deployments.length">
      <h2 class="mt-8 mb-3">実行履歴</h2>
      <v-card>
        <v-table class="design-table">
          <thead>
            <tr>
              <th>種類</th>
              <th>接続先</th>
              <th>バージョン</th>
              <th>状態</th>
              <th v-if="!xs">実行者</th>
              <th>開始</th>
              <th v-if="!xs">終了</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="d in database.deployments" :key="d.id" @click="shownDeployment = d.id">
              <td>{{ d.kind === 'build' ? 'ビルド' : 'マイグレーション' }}</td>
              <td>{{ d.connectionName }}</td>
              <td class="font-mono">{{ versionsOf(database, d) }}</td>
              <td>
                <v-chip :color="STATUS_COLORS[d.status]">{{ STATUS[d.status] }}</v-chip>
              </td>
              <td v-if="!xs">{{ d.executedByName }}</td>
              <td class="font-mono text-body-small">{{ dateTime(d.startedAt) }}</td>
              <td v-if="!xs" class="font-mono text-body-small">{{ dateTime(d.finishedAt) }}</td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
    </template>
    <v-dialog
      :model-value="!!shownDeployment"
      max-width="640"
      :class="['design-dialog', { 'bottom-sheet-dialog': xs }]"
      @update:model-value="shownDeployment = undefined"
    >
      <DeploymentProgress
        v-if="shownDeployment"
        :database-id="databaseId"
        :deployment-id="shownDeployment"
        :versions="database.versions"
      />
    </v-dialog>
    <NewVersionDialog
      v-if="creating"
      v-model="creating"
      :product-id="productId"
      :database-id="databaseId"
      :versions="database.versions"
      @done="openDesign"
    />
    <DefinitionExportDialog
      v-if="exporting"
      :model-value="true"
      :product-id="productId"
      :database-id="databaseId"
      :database-name="database.database.name"
      :target="product.product.target"
      :version="exporting"
      :versions="database.versions"
      @update:model-value="exporting = undefined"
    />
  </DatabasePage>
</template>
