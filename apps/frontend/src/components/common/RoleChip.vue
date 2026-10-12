<script setup lang="ts">
import { ROLE_LABELS, type Role } from 'utils'
defineProps<{ role: Role }>()
</script>
<template>
  <v-chip :class="`role-chip role-${role}`">{{ ROLE_LABELS[role] }}</v-chip>
</template>
