<script setup lang="ts">
import { ref } from 'vue'

import { succeeded } from '../../api/call.ts'
import { useDevLogin } from '../../composables/useAuthMutations.ts'

// Development login: signs in as any email without Google. Loaded only in `vp dev` (the sign-in
// screen imports it behind `import.meta.env.DEV`, so a production build leaves it out), and the
// API accepts it only when the runtime package turned it on (root `AGENTS.md` "Auth").
const emit = defineEmits<{ signedIn: [] }>()
const devLogin = useDevLogin()
const email = ref('')
const name = ref('')

const submit = async () => {
  const input = { email: email.value.trim(), name: name.value.trim() }
  if (await succeeded(devLogin.mutateAsync(input))) emit('signedIn')
}
</script>

<template>
  <v-card variant="outlined" class="pa-4">
    <div class="text-caption font-weight-bold mb-3">開発用ログイン（開発環境のみ）</div>
    <v-form @submit.prevent="submit">
      <v-text-field v-model="email" label="メールアドレス" type="email" autocomplete="off" />
      <v-text-field v-model="name" label="ユーザー名" autocomplete="off" />
      <v-alert
        v-if="devLogin.error.value"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
        :text="devLogin.error.value.message"
      />
      <v-btn
        type="submit"
        block
        variant="outlined"
        :loading="devLogin.isPending.value"
        :disabled="!email.trim() || !name.trim()"
        text="開発用ログイン"
      />
    </v-form>
  </v-card>
</template>
