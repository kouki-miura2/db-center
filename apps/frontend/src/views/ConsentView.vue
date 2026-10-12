<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'

import { succeeded } from '../api/call.ts'
import ConsentCheckbox from '../components/auth/ConsentCheckbox.vue'
import { useConsent, useSignOut } from '../composables/useAuthMutations.ts'
import { LEGAL_VERSION } from '../legal/documents.ts'

// Agreeing again after the terms or the privacy policy changed: until then, the app can't be used
// ("共通ルール > 同意"). Signing out stays possible.
const router = useRouter()
const consent = useConsent()
const signOut = useSignOut()
const agreed = ref(false)
const message = `引き続きご利用いただくには、改定後の内容（${LEGAL_VERSION} 版）をご確認のうえ、同意してください。`

const submit = async () => {
  if (await succeeded(consent.mutateAsync())) await router.replace({ name: 'products' })
}

const leave = async () => {
  await signOut.mutateAsync()
  await router.replace({ name: 'login' })
}
</script>

<template>
  <v-container class="page d-flex justify-center">
    <v-card max-width="480" class="pa-6 w-100">
      <h1 class="text-h6 font-weight-bold mb-2">利用規約・プライバシーポリシーが改定されました</h1>
      <p class="text-body-2 text-medium-emphasis mb-4">
        {{ message }}
      </p>
      <ConsentCheckbox v-model="agreed" class="mb-4" />
      <v-alert
        v-if="consent.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        :text="consent.error.value.message"
      />
      <v-btn
        color="primary"
        size="large"
        block
        :disabled="!agreed"
        :loading="consent.isPending.value"
        text="同意して続ける"
        @click="submit"
      />
      <v-btn
        variant="text"
        size="small"
        block
        class="mt-2"
        :loading="signOut.isPending.value"
        text="ログアウト"
        @click="leave"
      />
    </v-card>
  </v-container>
</template>
