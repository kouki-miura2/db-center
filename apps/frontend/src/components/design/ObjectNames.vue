<script setup lang="ts">
import { ApiError } from '../../api/call.ts'
import DesignField from './DesignField.vue'
defineProps<{ disabled: boolean; error?: unknown }>()
const name = defineModel<string>('name', { required: true })
const logicalName = defineModel<string | null>('logicalName', { required: true })
</script>
<template>
  <DesignField
    v-model="name"
    label="物理名"
    required
    :disabled="disabled"
    :error="error instanceof ApiError ? error.fields?.name : undefined"
  /><DesignField
    v-model="logicalName"
    label="論理名"
    :mono="false"
    :disabled="disabled"
    :error="error instanceof ApiError ? error.fields?.logicalName : undefined"
  />
</template>
