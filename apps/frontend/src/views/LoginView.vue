<script setup lang="ts">
import { charLength, LIMITS } from 'utils'
import { computed, defineAsyncComponent, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { succeeded } from '../api/call.ts'
import AuthLayout from '../components/auth/AuthLayout.vue'
import ConsentCheckbox from '../components/auth/ConsentCheckbox.vue'
import GoogleSignInButton from '../components/auth/GoogleSignInButton.vue'
import { useGoogleSignIn, useRegister } from '../composables/useAuthMutations.ts'
import { safeRedirect } from '../router/guard.ts'

// Sign in with Google (design 1a, STEP 1) and, for an account not registered yet, the user name
// and consent (1b, STEP 2): the user is created only after agreeing ("共通ルール > 同意").
const route = useRoute()
const router = useRouter()
const googleSignIn = useGoogleSignIn()
const register = useRegister()
// Development only: `import.meta.env.DEV` is false in a build, which then drops the form.
const DevLoginForm = import.meta.env.DEV
  ? defineAsyncComponent(() => import('../components/auth/DevLoginForm.vue'))
  : null

const registration = ref<{ idToken: string; email: string } | null>(null)
const name = ref('')
const agreed = ref(false)

const nameRules = [
  (v: string) => v.trim().length > 0 || 'ユーザー名を入力してください',
  (v: string) =>
    charLength(v) <= LIMITS.userNameMaxLength ||
    `${LIMITS.userNameMaxLength}文字以内で入力してください`,
]
const nameValid = computed(() => nameRules.every((rule) => rule(name.value) === true))
const error = computed(() => googleSignIn.error.value ?? register.error.value ?? null)

const goOn = () => router.replace(safeRedirect(route.query.redirect))

const onCredential = async (idToken: string) => {
  const result = await googleSignIn.mutateAsync(idToken).catch(() => null)
  if (!result) return
  if (result.status === 'signed_in') return goOn()
  registration.value = { idToken, email: result.email }
  name.value = result.suggestedName ?? ''
}

const submitRegistration = async () => {
  if (!registration.value || !nameValid.value || !agreed.value) return
  const input = { idToken: registration.value.idToken, name: name.value }
  if (await succeeded(register.mutateAsync(input))) await goOn()
}

const restart = () => {
  registration.value = null
  agreed.value = false
  register.reset()
  googleSignIn.reset()
}
</script>

<template>
  <AuthLayout>
    <template v-if="!registration">
      <div>
        <div class="text-caption font-weight-bold font-mono text-primary mb-2">STEP 1 / 2</div>
        <h1 class="text-h5 font-weight-bold mb-2">ログイン</h1>
        <p class="text-body-2 text-medium-emphasis">
          Googleアカウントでログインします。初めての方は、続けてユーザー名の登録と規約への同意を行います。
        </p>
      </div>
      <GoogleSignInButton @credential="onCredential" />
      <v-progress-linear v-if="googleSignIn.isPending.value" indeterminate color="primary" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error.message" />
      <div>
        <div class="text-caption text-medium-emphasis mb-2">ご利用前にご確認ください</div>
        <div class="d-flex flex-wrap ga-2">
          <v-btn
            :to="{ name: 'terms' }"
            variant="outlined"
            size="small"
            prepend-icon="mdi-file-document-outline"
            text="利用規約"
          />
          <v-btn
            :to="{ name: 'privacy' }"
            variant="outlined"
            size="small"
            prepend-icon="mdi-shield-account-outline"
            text="プライバシーポリシー"
          />
        </div>
      </div>
      <component :is="DevLoginForm" v-if="DevLoginForm" @signed-in="goOn" />
    </template>

    <v-form v-else class="d-flex flex-column ga-6" @submit.prevent="submitRegistration">
      <div>
        <div class="text-caption font-weight-bold font-mono text-primary mb-2">STEP 2 / 2</div>
        <h1 class="text-h5 font-weight-bold">ユーザー登録</h1>
      </div>
      <v-sheet border rounded="lg" color="background" class="d-flex align-center ga-3 pa-3">
        <v-icon icon="mdi-google" color="medium-emphasis" />
        <div class="flex-grow-1 overflow-hidden">
          <div class="text-caption text-medium-emphasis">Googleアカウント</div>
          <div class="text-body-2 font-mono text-truncate">{{ registration.email }}</div>
        </div>
        <v-icon icon="mdi-check-circle" color="success" />
      </v-sheet>
      <v-text-field
        v-model="name"
        label="ユーザー名 *"
        hint="ツール内で他のメンバーに表示される名前です"
        persistent-hint
        :rules="nameRules"
        :counter="LIMITS.userNameMaxLength"
        :counter-value="charLength"
        autofocus
      />
      <ConsentCheckbox v-model="agreed" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error.message" />
      <v-btn
        type="submit"
        color="primary"
        size="large"
        block
        :loading="register.isPending.value"
        :disabled="!nameValid || !agreed"
        text="登録して始める"
      />
      <v-btn variant="text" size="small" text="別のアカウントでログインする" @click="restart" />
    </v-form>
  </AuthLayout>
</template>
