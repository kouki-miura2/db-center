<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { ApiError, succeeded } from '../../api/call.ts'
import { useWithdraw } from '../../composables/useAuthMutations.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useProductListQuery } from '../../composables/useProductListQuery.ts'

// Withdrawal ("各論 > Googleでログイン > 退会"): not while the user owns a product (delete it
// first). Their designs and history stay in the products; the name shows as "退会したユーザー".
const open = defineModel<boolean>({ required: true })
const router = useRouter()
const online = useOnline()
const products = useProductListQuery()
const withdraw = useWithdraw()

const owned = computed(
  () => products.data.value?.data.filter((product) => product.role === 'owner') ?? [],
)

// The API refuses an owner with `stale_update` too (if the list above was out of date or failed).
const errorMessage = computed(() => {
  const error = withdraw.error.value
  if (!error) return null
  return error instanceof ApiError && error.code === 'stale_update'
    ? 'オーナーのプロダクトがあるため退会できません。先にプロダクトを削除してください'
    : error.message
})

const submit = async () => {
  if (!(await succeeded(withdraw.mutateAsync()))) return
  open.value = false
  await router.replace({ name: 'login' })
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card class="pa-2">
      <v-card-title class="text-h6 font-weight-bold">退会しますか？</v-card-title>
      <v-card-text class="text-body-2">
        <v-progress-linear v-if="products.isPending.value" indeterminate color="primary" />
        <template v-else-if="owned.length > 0">
          <v-alert type="warning" variant="tonal" density="compact" class="mb-3">
            オーナーのプロダクトがあるため退会できません。先にプロダクトを削除してください。
          </v-alert>
          <ul class="pl-5">
            <li v-for="product in owned" :key="product.id">{{ product.name }}</li>
          </ul>
        </template>
        <template v-else>
          <p class="mb-2">
            参加しているプロダクトから退出し、Googleアカウントの情報を削除します。この操作は取り消せません。
          </p>
          <p class="text-medium-emphasis">
            作成した設計や実行履歴はプロダクトに残り、名前は「退会したユーザー」と表示されます。
          </p>
        </template>
        <v-alert
          v-if="errorMessage"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
          :text="errorMessage"
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" text="キャンセル" @click="open = false" />
        <v-btn
          v-if="!products.isPending.value && owned.length === 0"
          color="error"
          :disabled="!online"
          :loading="withdraw.isPending.value"
          text="退会する"
          @click="submit"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
