<script setup lang="ts">
import { computed, ref } from 'vue'

import { ApiError, succeeded } from '../../api/call.ts'
import { useDevLogin } from '../../composables/useAuthMutations.ts'

// Development login: signs in as any email without Google. Loaded only in `vp dev` (the sign-in
// screen imports it behind `import.meta.env.DEV`, so a production build leaves it out), and the
// API accepts it only when the runtime package turned it on (root `AGENTS.md` "Auth").
const emit = defineEmits<{ signedIn: []; cancel: [] }>()
const devLogin = useDevLogin()
const email = ref('')
const name = ref('')
const emailRules = [
  (value: string) => value.trim().length > 0 || 'メールアドレスを入力してください',
  (value: string) =>
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()) || 'メールアドレスの形式が正しくありません',
]
const errorMessage = computed(() => {
  const error = devLogin.error.value
  if (error instanceof ApiError && error.code === 'not_found') {
    return '開発用ログインが無効です。apps/backend-worker/.dev.vars に DEV_LOGIN=true を設定し、バックエンドを再起動してください。'
  }
  return error?.message
})

const submit = async () => {
  const input = { email: email.value.trim(), name: name.value.trim() }
  if (await succeeded(devLogin.mutateAsync(input))) emit('signedIn')
}
</script>

<template>
  <v-card color="surface" elevation="8" class="dev-login-card">
    <v-card-title class="dev-login-title">
      <span>開発用ログイン</span>
      <v-btn
        icon="mdi-close"
        variant="text"
        size="small"
        aria-label="閉じる"
        @click="emit('cancel')"
      />
    </v-card-title>
    <v-card-text class="dev-login-content">
      <p class="dev-login-description">
        有効な形式の任意のメールアドレスを使用できます。同じアドレスでは、次回も同じ開発ユーザーとしてログインします。
      </p>
      <v-form id="dev-login-form" @submit.prevent="submit">
        <v-text-field
          v-model="email"
          label="メールアドレス"
          placeholder="owner@example.com"
          type="email"
          autocomplete="off"
          :rules="emailRules"
        />
        <v-text-field
          v-model="name"
          label="ユーザー名"
          placeholder="開発ユーザー"
          autocomplete="off"
        />
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-4"
          :text="errorMessage"
        />
      </v-form>
    </v-card-text>
    <v-card-actions class="dev-login-actions">
      <v-btn variant="text" text="キャンセル" @click="emit('cancel')" />
      <v-btn
        type="submit"
        form="dev-login-form"
        color="primary"
        :loading="devLogin.isPending.value"
        :disabled="!email.trim() || !name.trim()"
        text="ログイン"
      />
    </v-card-actions>
  </v-card>
</template>

<style scoped>
.dev-login-card {
  width: 100%;
  border-color: #e3e5ea;
  background: white;
}
.dev-login-title {
  min-height: 56px;
  padding: 12px 16px 12px 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 18px;
  font-weight: 600;
}
.dev-login-content {
  padding: 8px 20px 4px;
}
.dev-login-description {
  margin: 0 0 20px;
  color: #5b6270;
  font-size: 13px;
  line-height: 1.7;
}
.dev-login-actions {
  padding: 12px 20px 20px;
  justify-content: flex-end;
  gap: 8px;
}
@media (max-width: 599px) {
  .dev-login-title {
    font-size: 17px;
  }
  .dev-login-content {
    padding-inline: 16px;
  }
  .dev-login-actions {
    padding-inline: 16px;
  }
}
</style>
