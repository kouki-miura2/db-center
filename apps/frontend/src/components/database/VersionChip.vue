<script setup lang="ts">
import type { ProductData } from '../../composables/useProductQuery.ts'
defineProps<{ version: ProductData['databases'][number]['latestVersion'] }>()
const labels = { editing: '編集中', provisional: '仮確定', final: '確定' }
</script>
<template>
  <v-chip
    :color="
      version.status === 'editing' ? 'warning' : version.status === 'final' ? 'success' : 'primary'
    "
    >v{{ version.number }} · {{ labels[version.status] }}</v-chip
  >
</template>
