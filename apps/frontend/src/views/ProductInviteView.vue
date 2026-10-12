<script setup lang="ts">
import { formatDate, isAllowed, LIMITS, ROLE_LABELS } from 'utils'
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import OperationError from '../components/common/OperationError.vue'
import MemberList from '../components/product/MemberList.vue'
import { useMemberMutations, type Invitees } from '../composables/useMemberMutations.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'
import { fieldError, required } from '../forms/input.ts'
import { useNotificationStore } from '../stores/notification.ts'
const props = defineProps<{ productId: string }>()
const query = useProductQuery(props.productId)
const data = computed(() => query.data.value?.data)
const mutation = useMemberMutations(props.productId)
const online = useOnline()
const notification = useNotificationStore()
const { xs } = useDisplay()
const invitees = ref<Invitees>([{ email: '', role: 'member' }])
const valid = ref(false)
const code = ref<{ passcode: string; expiresAt: number } | null>(null)
const roles = computed(() =>
  data.value?.role === 'owner' ? (['member', 'manager'] as const) : (['member'] as const),
)
const roleItems = computed(() => roles.value.map((value) => ({ value, title: ROLE_LABELS[value] })))
const canInvite = computed(() => !!data.value && isAllowed(data.value.role, 'inviteOrRemoveMember'))
const error = computed(() => query.error.value ?? mutation.invite.error.value)
const invite = async () => {
  try {
    code.value = await mutation.invite.mutateAsync(
      invitees.value.map((row) => ({
        email: row.email.trim(),
        role: data.value?.role === 'manager' ? 'member' : row.role,
      })),
    )
    invitees.value = [{ email: '', role: 'member' }]
  } catch {
    /* Shown in the form. */
  }
}
const copy = async () => {
  try {
    await navigator.clipboard.writeText(code.value?.passcode ?? '')
    notification.show('招待コードをコピーしました')
  } catch {
    notification.show('コピーできませんでした。コードを選択してコピーしてください')
  }
}
const share = async () => {
  try {
    if (code.value)
      await navigator.share({
        title: 'db-centerへの招待',
        text: `招待コード: ${code.value.passcode}\n有効期限: ${formatDate(new Date(code.value.expiresAt), 'yyyy/MM/dd HH:mm')}`,
      })
  } catch {
    /* Cancelling a share is harmless. */
  }
}
const canShare = typeof navigator !== 'undefined' && !!navigator.share
</script>
<template>
  <v-container class="page form-page">
    <h1 class="text-h5 font-weight-bold mb-2">ユーザーを招待</h1>
    <p class="text-body-2 text-medium-emphasis mb-6">
      {{ data?.product.name }} にGoogleアカウントで参加するユーザーを招待します。
    </p>
    <OperationError :error="error" @reload="query.refetch()" />
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <template v-else-if="data">
      <v-form v-if="canInvite" v-model="valid" @submit.prevent="invite">
        <v-card class="mb-6"
          ><v-card-text>
            <h2 class="text-subtitle-1 font-weight-bold mb-4">招待するユーザー</h2>
            <p class="text-body-2 mb-4">
              参加には招待先のGoogleアカウントと招待コードが必要です。招待コードは直接相手に伝えてください。
            </p>
            <v-alert
              v-if="fieldError(error, 'invitees')"
              type="error"
              variant="tonal"
              :text="fieldError(error, 'invitees')"
              class="mb-3"
            />
            <div v-for="(row, index) in invitees" :key="index" class="d-flex flex-wrap ga-2 mb-2">
              <v-text-field
                v-model="row.email"
                label="Googleアカウント（メールアドレス）"
                type="email"
                :rules="[
                  required,
                  (value: string) =>
                    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) || 'メールアドレスを入力してください',
                ]"
                :error-messages="fieldError(error, `invitees.${index}.email`)"
                :disabled="!online || mutation.invite.isPending.value"
                class="invite-email"
              />
              <v-select
                v-model="row.role"
                label="ユーザー種別"
                :items="roleItems"
                :disabled="!online || mutation.invite.isPending.value || roles.length === 1"
                :error-messages="fieldError(error, `invitees.${index}.role`)"
                class="invite-role"
              />
              <v-btn
                icon="mdi-close"
                variant="text"
                size="small"
                aria-label="招待行を削除"
                :disabled="!online || mutation.invite.isPending.value || invitees.length === 1"
                @click="invitees.splice(index, 1)"
              />
            </div>
            <v-btn
              variant="outlined"
              prepend-icon="mdi-plus"
              :disabled="
                !online ||
                mutation.invite.isPending.value ||
                invitees.length >= LIMITS.membersPerProduct
              "
              @click="invitees.push({ email: '', role: 'member' })"
              >行を追加</v-btn
            > </v-card-text
          ><v-card-actions
            ><v-spacer /><v-btn
              type="submit"
              color="primary"
              :disabled="!online || !valid"
              :loading="mutation.invite.isPending.value"
              >招待コードを表示する</v-btn
            ></v-card-actions
          ></v-card
        >
      </v-form>
      <v-alert
        v-else
        type="info"
        variant="tonal"
        class="mb-6"
        text="このロールではユーザーを招待できません"
      />
      <MemberList :product-id="productId" :data="data" />
    </template>
    <v-dialog
      :model-value="!!code"
      :fullscreen="xs"
      @update:model-value="
        (value) => {
          if (!value) code = null
        }
      "
      ><v-card>
        <v-card-title>招待コード</v-card-title
        ><v-card-text
          ><p>招待したユーザーにこのコードを伝えてください。</p>
          <div class="font-mono text-h3 text-primary text-center my-6 text-selectable">
            {{ code?.passcode }}
          </div>
          <p class="text-body-2 text-center">
            有効期限 {{ code && formatDate(new Date(code.expiresAt), 'yyyy/MM/dd HH:mm') }}
          </p></v-card-text
        >
        <v-card-actions
          ><v-btn variant="outlined" prepend-icon="mdi-content-copy" @click="copy">コピー</v-btn
          ><v-btn
            v-if="canShare && xs"
            variant="outlined"
            prepend-icon="mdi-share-variant"
            @click="share"
            >共有</v-btn
          ><v-spacer /><v-btn @click="code = null">閉じる</v-btn></v-card-actions
        >
      </v-card></v-dialog
    >
  </v-container>
</template>
