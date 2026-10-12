<script setup lang="ts">
import { ROLE_LABELS, type Role } from 'utils'
defineProps<{ role: Role }>()
</script>
<template>
  <v-chip :color="role === 'owner' ? 'primary' : role === 'manager' ? 'info' : undefined">{{
    ROLE_LABELS[role]
  }}</v-chip>
</template>
