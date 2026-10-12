<script setup lang="ts">
import { onMounted, ref, useTemplateRef, watch } from 'vue'
import { useDisplay } from 'vuetify'

import { renderGoogleButton } from '../../auth/google.ts'

// The official "Googleでログイン" button, drawn by Google. Without a client ID (local development)
// a disabled stand-in of the same size takes its place (`docs/agents/public-app.md`).
const emit = defineEmits<{ credential: [idToken: string] }>()

const clientId = import.meta.env.VITE_GOOGLE_WEB_CLIENT_ID || ''
const container = useTemplateRef<HTMLDivElement>('container')
const failed = ref(false)
const { width } = useDisplay()
let renderedWidth = 0

const draw = () => {
  const target = container.value
  if (!clientId || !target) return
  const nextWidth = Math.min(target.clientWidth, 400)
  if (!nextWidth || nextWidth === renderedWidth) return
  renderedWidth = nextWidth
  target.replaceChildren()
  failed.value = false
  renderGoogleButton(target, clientId, (idToken) => emit('credential', idToken)).catch(
    () => (failed.value = true),
  )
}

onMounted(draw)
// Google fixes its iframe's width when rendering; redraw when the responsive form changes width.
watch(width, draw, { flush: 'post' })
</script>

<template>
  <div class="google-sign-in">
    <div v-if="clientId" ref="container" class="google-button" />
    <v-alert
      v-if="failed"
      type="warning"
      variant="tonal"
      density="compact"
      class="mt-3"
      text="Googleでログインのボタンを読み込めませんでした。通信を確認して、再読み込みしてください"
    />
    <v-btn
      v-if="!clientId"
      disabled
      block
      size="large"
      rounded="sm"
      variant="outlined"
      class="google-placeholder"
      max-width="400"
      prepend-icon="mdi-google"
      text="Googleでログイン"
    />
    <p v-if="!clientId" class="google-unconfigured">Googleログインは未設定です</p>
  </div>
</template>

<style scoped>
.google-button {
  min-height: 40px;
  display: flex;
  justify-content: center;
}
.google-sign-in {
  min-height: 71px;
}
.google-placeholder {
  height: 46px;
  margin-inline: auto;
  border-radius: 4px;
  border-color: #dadce0;
  font-size: 14px;
  letter-spacing: 0;
}
.google-placeholder.v-btn--disabled {
  opacity: 1;
  color: #9aa0ab;
}
.google-unconfigured {
  margin: 8px 0 0;
  color: #9aa0ab;
  text-align: center;
  font-size: 11px;
  line-height: 17px;
}
@media (max-width: 959px) {
  .google-sign-in {
    min-height: 50px;
  }
  .google-placeholder {
    height: 50px;
  }
  .google-unconfigured {
    display: none;
  }
}
</style>
