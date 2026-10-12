<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { ApiError } from '../api/call.ts'
import OperationError from '../components/common/OperationError.vue'
import { useMemberMutations } from '../composables/useMemberMutations.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useAuthStore } from '../stores/auth.ts'
const mutation = useMemberMutations('')
const auth = useAuthStore()
const router = useRouter()
const online = useOnline()
const passcode = ref('')
const { xs } = useDisplay()
const acceptable = computed(() => /^[a-z0-9]{8}$/i.test(passcode.value.trim()))
const blocked = computed(
  () =>
    mutation.join.error.value instanceof ApiError &&
    mutation.join.error.value.code === 'too_many_attempts',
)
const join = async () => {
  if (!acceptable.value || blocked.value || !online.value) return
  try {
    const product = await mutation.join.mutateAsync(passcode.value.trim())
    await router.replace({ name: 'product', params: { productId: product.id } })
  } catch {
    /* Shown in the form. */
  }
}
</script>
<template>
  <v-container class="page join-page design-screen">
    <v-card class="join-card">
      <div class="join-icon"><v-icon size="24">mdi-key-outline</v-icon></div>
      <h1 class="screen-title">{{ xs ? 'パスコードを入力' : 'プロダクトに参加' }}</h1>
      <p class="screen-caption mt-3">招待した方から受け取った8桁のパスコードを入力してください。</p>
      <v-form @submit.prevent="join">
        <v-otp-input
          v-model="passcode"
          :length="8"
          type="text"
          :pattern="/^[a-z0-9]*$/i"
          label="パスコード"
          class="font-mono"
          :disabled="!online || mutation.join.isPending.value || blocked"
        />
        <p class="screen-caption">
          {{
            xs
              ? passcode.length + ' / 8 文字 ・ 貼り付け可'
              : '英数字・大文字小文字を区別しません／貼り付け可'
          }}
        </p>
        <p class="screen-caption mt-2 text-break">参加するアカウント：{{ auth.user?.email }}</p>
        <div :class="xs ? 'mobile-actions flex-column' : 'mt-6'">
          <v-btn
            type="submit"
            color="primary"
            block
            :disabled="!online || !acceptable || blocked"
            :loading="mutation.join.isPending.value"
            >参加する</v-btn
          >
          <p v-if="xs" class="text-center screen-caption">8文字入力すると押せるようになります</p>
        </div>
        <OperationError class="mt-5" :error="mutation.join.error.value" />
      </v-form>
    </v-card>
  </v-container>
</template>
