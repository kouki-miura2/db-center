<script setup lang="ts">
import { onMounted, ref, useTemplateRef } from 'vue'

import { renderGoogleButton } from '../../auth/google.ts'

// The official "Googleでログイン" button, drawn by Google. Without a client ID (local development)
// a disabled stand-in of the same size takes its place (`docs/agents/public-app.md`).
const emit = defineEmits<{ credential: [idToken: string] }>()

const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || ''
const container = useTemplateRef<HTMLDivElement>('container')
const failed = ref(false)

onMounted(() => {
  if (!clientId || !container.value) return
  renderGoogleButton(container.value, clientId, (idToken) => emit('credential', idToken)).catch(
    () => (failed.value = true),
  )
})
</script>

<template>
  <div v-if="clientId">
    <div ref="container" class="google-button" />
    <v-alert
      v-if="failed"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-3"
      text="Googleでログインのボタンを読み込めませんでした。通信を確認して、再読み込みしてください"
    />
  </div>
  <v-btn
    v-else
    disabled
    block
    size="large"
    rounded="pill"
    variant="outlined"
    height="40"
    max-width="400"
    prepend-icon="mdi-google"
    text="Googleでログイン"
  />
</template>

<style scoped>
.google-button {
  min-height: 44px;
}
</style>
