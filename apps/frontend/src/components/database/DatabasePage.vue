<script setup lang="ts">
import { computed } from 'vue'

import { type DatabaseData, useDatabaseQuery } from '../../composables/useDatabaseQuery.ts'
import { type ProductData, useProductQuery } from '../../composables/useProductQuery.ts'
import OperationError from '../common/OperationError.vue'
import VersionActions from '../version/VersionActions.vue'
import DbHeader, { type DatabaseSection } from './DbHeader.vue'

// The frame of the database-level screens (version history, build, migration): the database and
// product scopes, the header with the latest version's actions, and the screen's content.
const props = defineProps<{ productId: string; databaseId: string; section: DatabaseSection }>()
defineSlots<{
  default: (props: { database: DatabaseData; product: ProductData }) => unknown
}>()
const database = useDatabaseQuery(props.productId, props.databaseId)
const product = useProductQuery(props.productId)
const data = computed(() => database.data.value?.data)
const productData = computed(() => product.data.value?.data)
const reload = () => Promise.all([database.refetch(), product.refetch()])
</script>

<template>
  <div class="design-workspace design-screen">
    <OperationError :error="database.error.value ?? product.error.value" @reload="reload" />
    <v-progress-linear
      v-if="database.isPending.value || product.isPending.value"
      indeterminate
      color="primary"
      aria-label="読み込み中"
    />
    <template v-if="data && data.versions[0] && productData">
      <DbHeader
        :product-id="productId"
        :database-id="databaseId"
        :section="section"
        :product-name="productData.product.name"
        :target="productData.product.target"
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
            :role="productData.role"
            :target="productData.product.target"
            :database-name="data.database.name"
          />
        </template>
      </DbHeader>
      <v-container class="page">
        <slot :database="data" :product="productData" />
      </v-container>
    </template>
  </div>
</template>
