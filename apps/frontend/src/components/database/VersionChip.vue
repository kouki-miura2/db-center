<script setup lang="ts">
import type { ProductData } from '../../composables/useProductQuery.ts'
defineProps<{ version: ProductData['databases'][number]['latestVersion']; combined?: boolean }>()
const labels = { editing: '編集中', provisional: '仮確定', final: '確定' }
</script>
<template>
  <span class="version-label d-inline-flex align-center ga-2"
    ><span v-if="!combined" class="font-mono">v{{ version.number }}</span
    ><v-chip :class="'version-status status-' + version.status"
      ><span class="status-dot" /><span v-if="combined" class="font-mono mr-1"
        >v{{ version.number }}</span
      >{{ labels[version.status] }}</v-chip
    ></span
  >
</template>
