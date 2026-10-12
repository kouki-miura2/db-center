<script setup lang="ts">
import { formatDate } from 'utils'
import { computed, onMounted } from 'vue'

import { succeeded } from '../api/call.ts'
import OperationError from '../components/common/OperationError.vue'
import { useAuditLogs } from '../composables/useAuditLogs.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'
import { auditText } from '../product/audit.ts'
const props = defineProps<{ productId: string }>()
const product = useProductQuery(props.productId)
const { query, refresh } = useAuditLogs(props.productId)
const online = useOnline()
const entries = computed(() => query.data.value?.pages.flatMap((page) => page.entries) ?? [])
onMounted(() => {
  if (online.value && query.data.value) void succeeded(refresh.mutateAsync())
})
const more = (visible: boolean) => {
  if (visible && online.value && query.hasNextPage.value && !query.isFetching.value)
    void query.fetchNextPage()
}
</script>
<template>
  <v-container class="page"
    ><div class="d-flex align-center mb-6 ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold">操作履歴</h1>
        <p class="text-body-2 text-medium-emphasis mt-2">
          {{ product.data.value?.data.product.name }}
        </p>
      </div>
      <v-spacer /><v-btn
        variant="outlined"
        prepend-icon="mdi-refresh"
        :disabled="!online"
        :loading="refresh.isPending.value"
        @click="succeeded(refresh.mutateAsync())"
        >最新の履歴</v-btn
      >
    </div>
    <OperationError :error="query.error.value ?? refresh.error.value ?? product.error.value" />
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <v-card v-else
      ><v-list
        ><v-list-item
          v-for="entry in entries"
          :key="entry.id"
          :title="auditText(entry)"
          :subtitle="formatDate(new Date(entry.createdAt), 'yyyy/MM/dd HH:mm')"
          prepend-icon="mdi-history"
          class="py-3" /><v-list-item v-if="!entries.length" title="操作履歴はありません" /></v-list
    ></v-card>
    <div v-if="query.hasNextPage.value" v-intersect="more" class="text-center mt-6">
      <v-btn
        variant="outlined"
        :loading="query.isFetchingNextPage.value"
        :disabled="!online"
        @click="query.fetchNextPage()"
        >過去の履歴を読み込む</v-btn
      >
    </div>
  </v-container>
</template>
