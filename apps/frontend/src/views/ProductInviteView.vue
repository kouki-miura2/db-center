<script setup lang="ts">
import { formatDate, isAllowed, LIMITS, ROLE_LABELS } from 'utils'
import { computed, ref } from 'vue'
import { useDisplay } from 'vuetify'

import FormField from '../components/common/FormField.vue'
import OperationError from '../components/common/OperationError.vue'
import RoleChip from '../components/common/RoleChip.vue'
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
const sent = ref<Invitees>([])
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
    sent.value = invitees.value.map((row) => ({ ...row }))
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
const continueInviting = () => {
  code.value = null
  invitees.value = [{ email: '', role: 'member' }]
}
const canShare = typeof navigator !== 'undefined' && !!navigator.share
</script>
<template>
  <v-container class="page design-screen">
    <router-link v-if="!xs" :to="{ name: 'product', params: { productId } }" class="screen-back"
      ><v-icon size="16">mdi-arrow-left</v-icon>データベース一覧</router-link
    >
    <div v-if="!xs" class="screen-header">
      <h1 class="screen-title">ユーザーを招待</h1>
      <p class="screen-caption">
        参加者
        <span class="font-mono"
          >{{ data?.members.length ?? 0 }} + {{ data?.invitations.length ?? 0 }} /
          {{ LIMITS.membersPerProduct }}</span
        >
      </p>
    </div>
    <OperationError :error="error" @reload="query.refetch()" />
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <template v-else-if="data">
      <div class="invite-layout">
        <v-form
          v-if="canInvite && (!xs || !code)"
          v-model="valid"
          class="w-100"
          @submit.prevent="invite"
        >
          <v-card class="invite-form">
            <v-alert
              v-if="fieldError(error, 'invitees')"
              type="error"
              variant="tonal"
              :text="fieldError(error, 'invitees')"
              class="mb-3"
            />
            <div v-for="(row, index) in invitees" :key="index" class="invite-row">
              <FormField v-slot="{ id }" label="Googleアカウント"
                ><v-text-field
                  :id="id"
                  v-model="row.email"
                  aria-label="Googleアカウント（メールアドレス）"
                  placeholder="user@example.com"
                  type="email"
                  class="font-mono"
                  :rules="[
                    required,
                    (value: string) =>
                      /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ||
                      'メールアドレスを入力してください',
                  ]"
                  :error-messages="fieldError(error, 'invitees.' + index + '.email')"
                  :disabled="!online || mutation.invite.isPending.value || !!code"
                  hide-details="auto"
              /></FormField>
              <FormField v-slot="{ id }" label="ユーザー種別"
                ><v-select
                  :id="id"
                  v-model="row.role"
                  :items="roleItems"
                  :disabled="
                    !online || mutation.invite.isPending.value || roles.length === 1 || !!code
                  "
                  :error-messages="fieldError(error, 'invitees.' + index + '.role')"
                  hide-details="auto"
              /></FormField>
              <v-btn
                v-if="invitees.length > 1 && !code"
                icon="mdi-close"
                variant="text"
                size="small"
                aria-label="招待行を削除"
                :disabled="!online || mutation.invite.isPending.value"
                class="align-self-end"
                @click="invitees.splice(index, 1)"
              />
            </div>
            <p class="screen-caption">
              マネージャーとして招待できるのはオーナーのみです。招待コードを相手に伝えてください。
            </p>
            <div class="invite-controls">
              <v-btn
                variant="text"
                prepend-icon="mdi-plus"
                :disabled="
                  !online ||
                  mutation.invite.isPending.value ||
                  !!code ||
                  invitees.length >= LIMITS.membersPerProduct
                "
                @click="invitees.push({ email: '', role: 'member' })"
                >行を追加</v-btn
              ><v-btn v-if="code" variant="text" prepend-icon="mdi-check" disabled
                >招待コード発行済み</v-btn
              ><v-btn
                v-else
                type="submit"
                color="primary"
                :disabled="!online || !valid"
                :loading="mutation.invite.isPending.value"
                >招待コードを表示する</v-btn
              >
            </div>
          </v-card>
        </v-form>
        <v-card v-if="code" class="invite-code">
          <h2>招待コード</h2>
          <p v-if="!xs" class="screen-caption mt-1" style="color: #bac5df">
            招待した方に共有してください。プロダクト一覧の「プロダクトに参加」から入力します。
          </p>
          <div
            class="code-digits font-mono text-selectable"
            :aria-label="'招待コード ' + code.passcode"
          >
            <span v-for="(digit, index) in code.passcode" :key="index">{{ digit }}</span>
          </div>
          <div class="d-flex ga-2">
            <v-btn
              color="white"
              class="flex-grow-1"
              prepend-icon="mdi-content-copy"
              @click="copy"
              >{{ xs ? 'コピー' : 'コードをコピー' }}</v-btn
            ><v-btn
              v-if="canShare && xs"
              variant="outlined"
              prepend-icon="mdi-share-variant"
              @click="share"
              >共有</v-btn
            >
          </div>
          <p class="code-expiry">
            有効期限 {{ formatDate(new Date(code.expiresAt), 'yyyy/MM/dd HH:mm') }}
          </p>
        </v-card>
      </div>
      <v-card v-if="xs && code" class="mb-4"
        ><h2 class="text-body-medium font-weight-bold pa-4">招待したユーザー</h2>
        <v-divider />
        <div v-for="row in sent" :key="row.email" class="pa-4">
          <p class="font-mono text-body-medium mb-2 text-break">{{ row.email }}</p>
          <RoleChip :role="row.role" /><span class="member-status pending ml-2">● 仮登録</span>
        </div></v-card
      >
      <MemberList v-else :product-id="productId" :data="data" :show-invite="false" detailed />
      <div v-if="code" :class="xs ? 'mobile-actions' : 'd-flex justify-end mt-4'">
        <v-btn variant="outlined" prepend-icon="mdi-account-plus-outline" @click="continueInviting"
          >続けて招待する</v-btn
        >
      </div>
    </template>
  </v-container>
</template>
