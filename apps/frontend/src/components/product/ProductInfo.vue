<script setup lang="ts">
import { isAllowed, TARGETS } from 'utils'

import { useOnline } from '../../composables/useOnline.ts'
import type { ProductData } from '../../composables/useProductQuery.ts'
defineProps<{ productId: string; data: ProductData }>()
defineEmits<{ leave: [] }>()
const online = useOnline()
</script>
<template>
  <v-card class="product-info">
    <div class="d-flex align-center ga-2 mb-3">
      <h2>プロダクト情報</h2>
      <v-spacer /><v-btn
        v-if="isAllowed(data.role, 'renameProduct')"
        :to="{ name: 'product-settings', params: { productId } }"
        variant="text"
        color="primary"
        size="small"
        prepend-icon="mdi-cog-outline"
        :disabled="!online"
        >設定</v-btn
      ><v-menu
        ><template #activator="{ props: menu }"
          ><v-btn
            v-bind="menu"
            icon="mdi-dots-vertical"
            variant="text"
            size="x-small"
            aria-label="プロダクト情報の操作" /></template
        ><v-list density="compact"
          ><v-list-item
            :to="{ name: 'product-history', params: { productId } }"
            title="操作履歴" /><v-list-item
            v-if="isAllowed(data.role, 'leaveProduct')"
            title="プロダクトから退出"
            :disabled="!online"
            @click="$emit('leave')" /></v-list
      ></v-menu>
    </div>
    <p class="screen-caption info-target-label">ターゲット</p>
    <p class="font-mono mb-3">{{ TARGETS[data.product.target].label }}</p>
    <p class="screen-caption info-connections-label mb-2">データベース接続情報</p>
    <p v-if="!data.connections.length" class="screen-caption">接続情報はありません。</p>
    <div v-for="connection in data.connections" :key="connection.id" class="info-connection">
      <span class="connection-dot" /><span>{{ connection.name }}</span
      ><span class="font-mono screen-caption text-break">{{ connection.connectionString }}</span>
    </div>
  </v-card>
</template>
