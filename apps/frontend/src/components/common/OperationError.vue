<script setup lang="ts">
import { ApiError } from '../../api/call.ts'
import { errorMessage } from '../../forms/input.ts'
defineProps<{ error: unknown }>()
defineEmits<{ reload: [] }>()
</script>
<template>
  <v-alert v-if="error" type="error" variant="tonal" class="mb-4" role="alert">
    {{ errorMessage(error) }}
    <v-btn
      v-if="error instanceof ApiError && error.code === 'stale_update'"
      class="ml-2"
      variant="text"
      @click="$emit('reload')"
      >再読み込み</v-btn
    >
  </v-alert>
</template>
