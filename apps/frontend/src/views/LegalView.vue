<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { LEGAL_VERSION, PRIVACY, TERMS } from '../legal/documents.ts'

// The terms of service or the privacy policy, open without signing in. "戻る" goes back to the
// screen it was opened from (the sign-in screen, the account menu), or home in a new tab.
const props = defineProps<{ kind: 'terms' | 'privacy' }>()
const router = useRouter()
const document = computed(() => (props.kind === 'terms' ? TERMS : PRIVACY))

const back = () => {
  if (window.history.state?.back) router.back()
  else void router.replace({ name: 'products' })
}
</script>

<template>
  <v-container class="page" style="max-width: 800px">
    <v-btn
      variant="text"
      prepend-icon="mdi-arrow-left"
      text="戻る"
      class="mb-4 ml-n3"
      @click="back"
    />
    <h1 class="text-headline-small font-weight-bold mb-1">{{ document.title }}</h1>
    <div class="text-body-small text-medium-emphasis mb-6">{{ LEGAL_VERSION }} 版</div>
    <p class="text-body-medium mb-6">{{ document.intro }}</p>
    <section v-for="section in document.sections" :key="section.heading" class="mb-6">
      <h2 class="text-title-medium font-weight-bold mb-2">{{ section.heading }}</h2>
      <p v-for="(paragraph, i) in section.paragraphs" :key="i" class="text-body-medium mb-2">
        {{ paragraph }}
      </p>
    </section>
  </v-container>
</template>
