<script setup lang="ts">
import { TARGETS } from 'utils'
import { computed, ref, watch } from 'vue'
import { useRouter } from 'vue-router'

import OperationError from '../components/common/OperationError.vue'
import CommonColumnsDialog from '../components/database/CommonColumnsDialog.vue'
import VersionChip from '../components/database/VersionChip.vue'
import { useDatabaseQuery } from '../composables/useDatabaseQuery.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'
const props = defineProps<{ productId: string; databaseId: string; versionId?: string }>()
const query = useDatabaseQuery(props.productId, props.databaseId)
const product = useProductQuery(props.productId)
const data = computed(() => query.data.value?.data)
const version = computed(() => data.value?.versions.find((row) => row.id === props.versionId))
const router = useRouter()
const common = ref(false)
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
</script>
<template>
  <v-container class="page"
    ><OperationError
      :error="query.error.value ?? product.error.value"
      @reload="query.refetch()"
    /><v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-alert
      v-else-if="data && versionId && !version"
      type="error"
      variant="tonal"
      text="対象のバージョンが見つかりません"
    />
    <template v-if="data && version && product.data.value"
      ><p class="text-body-2 text-medium-emphasis mb-2">
        {{ product.data.value.data.product.name }} ·
        {{ TARGETS[product.data.value.data.product.target].label }}
      </p>
      <div class="d-flex align-center flex-wrap ga-3 mb-6">
        <h1 class="text-h5 font-weight-bold font-mono">{{ data.database.name }}</h1>
        <VersionChip
          :version="{ id: version.id, number: version.number, status: version.status }"
        />
      </div>
      <p v-if="data.database.description" class="text-body-2 mb-5">
        {{ data.database.description }}
      </p>
      <v-row
        ><v-col cols="12" sm="6"
          ><v-card
            ><v-card-title>設計</v-card-title
            ><v-card-text
              ><p v-if="product.data.value.data.product.target === 'postgresql18'" class="mb-2">
                スキーマ {{ version.schemaCount }}
              </p>
              <p>テーブル {{ version.tableCount }}</p></v-card-text
            ></v-card
          ></v-col
        ><v-col cols="12" sm="6"
          ><v-card
            ><v-card-title>共通カラムのセット</v-card-title
            ><v-card-text
              ><p class="text-body-2 mb-4">{{ data.commonColumns.length }}カラム</p>
              <v-btn variant="outlined" prepend-icon="mdi-table-column" @click="common = true"
                >共通カラムを表示</v-btn
              ></v-card-text
            ></v-card
          ></v-col
        ></v-row
      >
      <CommonColumnsDialog
        v-if="common"
        v-model="common"
        :product-id="productId"
        :database-id="databaseId"
        :target="product.data.value.data.product.target"
      />
    </template>
  </v-container>
</template>
