<script setup lang="ts">
import { charLength, LIMITS } from 'utils'
import { computed, defineAsyncComponent, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { succeeded } from '../api/call.ts'
import AuthLayout from '../components/auth/AuthLayout.vue'
import ConsentCheckbox from '../components/auth/ConsentCheckbox.vue'
import GoogleSignInButton from '../components/auth/GoogleSignInButton.vue'
import FormField from '../components/common/FormField.vue'
import { useGoogleSignIn, useRegister } from '../composables/useAuthMutations.ts'
import { safeRedirect } from '../router/guard.ts'

// Sign in with Google (design 1a, STEP 1) and, for an account not registered yet, the user name
// and consent (1b, STEP 2): the user is created only after agreeing ("共通ルール > 同意").
const route = useRoute()
const router = useRouter()
const { xs } = useDisplay()
const googleSignIn = useGoogleSignIn()
const register = useRegister()
// Development only: `import.meta.env.DEV` is false in a build, which then drops the form.
const DevLoginForm = import.meta.env.DEV
  ? defineAsyncComponent(() => import('../components/auth/DevLoginForm.vue'))
  : null

const registration = ref<{ idToken: string; email: string } | null>(null)
const name = ref('')
const agreed = ref(false)
const developmentOpen = ref(false)

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
  <AuthLayout :registration="!!registration">
    <div v-if="!registration" class="login-panel">
      <div class="auth-heading">
        <div class="auth-step font-mono">STEP 1 / 2</div>
        <h1 class="auth-title">ログイン</h1>
        <p class="auth-introduction">
          {{
            xs
              ? 'Googleアカウントでログインします。初めての方は続けてユーザー登録を行います。'
              : 'Googleアカウントでログインします。初めての方は、続けてユーザー名の登録と規約への同意を行います。'
          }}
        </p>
      </div>
      <GoogleSignInButton @credential="onCredential" />
      <v-progress-linear v-if="googleSignIn.isPending.value" indeterminate color="primary" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error.message" />
      <div class="auth-legal">
        <div class="auth-legal__caption">ご利用前にご確認ください</div>
        <div class="auth-legal__links">
          <v-btn
            :to="{ name: 'terms' }"
            variant="flat"
            class="auth-legal__button"
            prepend-icon="mdi-file-document-outline"
            text="利用規約"
          />
          <v-btn
            :to="{ name: 'privacy' }"
            variant="flat"
            class="auth-legal__button"
            prepend-icon="mdi-shield-account-outline"
            :text="xs ? 'プライバシー' : 'プライバシーポリシー'"
          />
        </div>
      </div>
    </div>

    <v-form v-else class="registration-panel" @submit.prevent="submitRegistration">
      <div class="auth-heading">
        <div class="auth-step font-mono">STEP 2 / 2</div>
        <h1 class="auth-title">ユーザー登録</h1>
      </div>
      <v-sheet border rounded="lg" class="auth-account">
        <v-avatar size="32" class="auth-account__avatar">{{
          Array.from(name.trim())[0] || 'G'
        }}</v-avatar>
        <div class="flex-grow-1 overflow-hidden">
          <div class="auth-account__label">Googleアカウント</div>
          <div class="auth-account__email font-mono text-truncate">{{ registration.email }}</div>
        </div>
        <v-icon icon="mdi-check-circle-outline" color="success" size="20" />
      </v-sheet>
      <FormField
        v-slot="{ id }"
        label="ユーザー名"
        required
        hint="ツール内で他のメンバーに表示される名前です"
      >
        <v-text-field
          :id="id"
          v-model="name"
          aria-label="ユーザー名"
          hide-details="auto"
          :rules="nameRules"
          autofocus
        />
      </FormField>
      <ConsentCheckbox v-model="agreed" />
      <v-alert v-if="error" type="error" variant="tonal" density="compact" :text="error.message" />
      <div class="auth-register-actions">
        <v-btn
          class="auth-register"
          type="submit"
          color="primary"
          size="large"
          block
          :loading="register.isPending.value"
          :disabled="!nameValid || !agreed"
          text="登録して始める"
        />
      </div>
      <v-btn
        class="auth-restart"
        variant="text"
        size="small"
        text="別のアカウントでログインする"
        @click="restart"
      />
    </v-form>
    <template v-if="DevLoginForm && !registration" #development>
      <v-dialog v-model="developmentOpen" max-width="440">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            class="auth-development"
            variant="text"
            size="small"
            text="開発用ログイン"
          />
        </template>
        <component :is="DevLoginForm" @cancel="developmentOpen = false" @signed-in="goOn" />
      </v-dialog>
    </template>
  </AuthLayout>
</template>

<style scoped>
.login-panel,
.registration-panel {
  display: flex;
  flex-direction: column;
  gap: 28px;
  width: 100%;
}
.registration-panel {
  gap: 24px;
  position: relative;
}
.auth-heading {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.auth-step {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.25;
  color: #2f55d4;
}
.auth-title {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.5;
}
.auth-introduction {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  color: #5b6270;
}
.auth-legal {
  border-top: 1px solid #e3e5ea;
  padding-top: 20px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.auth-legal__caption {
  color: #5b6270;
  font-size: 12px;
  line-height: 1.5;
}
.auth-legal__links {
  display: flex;
  gap: 8px;
}
.auth-legal__button {
  height: 32px;
  padding-inline: 10px;
  border-radius: 6px;
  color: #2f55d4;
  background: #f2f5fd;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0;
}
.auth-legal__button :deep(.v-btn__prepend) {
  margin-right: 6px;
}
.auth-legal__button :deep(.v-icon) {
  font-size: 18px;
}
.auth-account {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-color: #e3e5ea;
  background: #f7f8fa;
}
.auth-account__avatar {
  color: #2443b0;
  background: #dce3f9;
  font-size: 13px;
  font-weight: 600;
}
.auth-account__label {
  font-size: 12px;
  line-height: 1.5;
  color: #5b6270;
}
.auth-account__email {
  margin-top: 2px;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.3;
}
.registration-panel :deep(.field-label) {
  font-weight: 500;
  margin-bottom: 6px;
}
.registration-panel :deep(.field-hint) {
  margin-top: 6px;
  line-height: 1.5;
}
.registration-panel :deep(.v-field) {
  border-radius: 6px;
}
.auth-register {
  height: 44px;
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0;
  border-radius: 6px;
}
.auth-restart {
  position: absolute;
  top: calc(100% + 12px);
  align-self: center;
  color: #5b6270;
}
.auth-development {
  position: absolute;
  right: 16px;
  bottom: 8px;
  color: #5b6270;
}
@media (min-width: 600px) and (max-width: 959px) {
  .auth-legal__caption {
    display: none;
  }
  .auth-legal__button {
    height: 40px;
    padding-inline: 12px;
  }
  .auth-register {
    height: 48px;
    font-size: 15px;
  }
  .registration-panel :deep(.v-field__input) {
    min-height: 46px;
    font-size: 15px;
  }
}
@media (max-width: 599px) {
  .login-panel {
    gap: 24px;
  }
  .auth-heading {
    gap: 6px;
  }
  .auth-title {
    font-size: 20px;
  }
  .auth-legal {
    margin-top: auto;
    border: 0;
    padding: 0;
  }
  .auth-legal__caption {
    display: none;
  }
  .auth-legal__links {
    display: grid;
    grid-template-columns: 1fr 1fr;
  }
  .auth-legal__button {
    height: 44px;
    padding-inline: 8px;
    min-width: 0;
  }
  .registration-panel {
    gap: 20px;
  }
  .registration-panel :deep(.v-field__input) {
    min-height: 48px;
    font-size: 16px;
  }
  .auth-register {
    height: 48px;
    font-size: 15px;
    flex: none;
  }
  .auth-register-actions {
    margin-top: auto;
    margin-inline: -20px;
    padding: 12px 20px 0;
    border-top: 1px solid #e3e5ea;
  }
  .auth-restart {
    top: calc(100% + 4px);
    height: 20px;
    font-size: 11px;
  }
  .auth-development {
    bottom: 0;
    height: 24px;
    font-size: 11px;
  }
}
</style>
