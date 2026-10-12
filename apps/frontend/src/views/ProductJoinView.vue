<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'

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
  <v-container class="page join-page"
    ><h1 class="text-h5 font-weight-bold mb-2">プロダクトに参加</h1>
    <p class="text-body-2 text-medium-emphasis mb-6">
      招待された8桁のパスコードを入力してください。
    </p>
    <v-card
      ><v-card-text class="pa-6"
        ><OperationError :error="mutation.join.error.value" /><v-chip
          prepend-icon="mdi-account-outline"
          class="mb-5"
          >{{ auth.user?.email }}</v-chip
        ><v-form @submit.prevent="join"
          ><v-text-field
            v-model="passcode"
            label="パスコード"
            class="font-mono"
            autocomplete="off"
            autocapitalize="characters"
            spellcheck="false"
            maxlength="8"
            :disabled="!online || mutation.join.isPending.value || blocked"
            hint="大文字・小文字は区別しません。貼り付けもできます"
            persistent-hint
          /><v-btn
            type="submit"
            color="primary"
            block
            class="mt-6"
            :disabled="!online || !acceptable || blocked"
            :loading="mutation.join.isPending.value"
            >参加する</v-btn
          ></v-form
        ></v-card-text
      ></v-card
    >
  </v-container>
</template>
