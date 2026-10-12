<script setup lang="ts">
import { formatDate, isAllowed, LIMITS } from 'utils'
import { computed, ref } from 'vue'

import { succeeded } from '../../api/call.ts'
import { useMemberMutations } from '../../composables/useMemberMutations.ts'
import { useOnline } from '../../composables/useOnline.ts'
import type { Member, ProductData } from '../../composables/useProductQuery.ts'
import { memberActions, sortMembers } from '../../product/members.ts'
import { useAuthStore } from '../../stores/auth.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import OperationError from '../common/OperationError.vue'
import RoleChip from '../common/RoleChip.vue'

const props = defineProps<{ productId: string; data: ProductData }>()
const actions = useMemberMutations(props.productId)
const auth = useAuthStore()
const online = useOnline()
const notification = useNotificationStore()
const members = computed(() => sortMembers(props.data.members))
const permissions = (member: Member) => memberActions(props.data.role, auth.user?.id ?? '', member)
const confirmation = ref<{ kind: 'remove' | 'transfer'; member: Member } | null>(null)
const code = ref<{ passcode: string; expiresAt: number } | null>(null)
const error = computed(
  () =>
    actions.changeRole.error.value ??
    actions.removeMember.error.value ??
    actions.transfer.error.value ??
    actions.passcode.error.value,
)
const pending = computed(
  () =>
    actions.changeRole.isPending.value ||
    actions.removeMember.isPending.value ||
    actions.transfer.isPending.value ||
    actions.passcode.isPending.value,
)
const confirm = async () => {
  const input = confirmation.value
  if (!input) return
  const ok = await succeeded(
    input.kind === 'remove'
      ? actions.removeMember.mutateAsync(input.member.userId)
      : actions.transfer.mutateAsync(input.member.userId),
  )
  if (ok) {
    confirmation.value = null
    notification.show('参加者を更新しました')
  }
}
const showCode = async (id: string) => {
  try {
    code.value = await actions.passcode.mutateAsync(id)
  } catch {
    /* Shown by the mutation's error. */
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
</script>
<template>
  <v-card>
    <v-card-title class="d-flex align-center ga-2"
      ><v-icon size="20">mdi-account-group-outline</v-icon>参加者
      <span class="text-caption text-medium-emphasis"
        >{{ data.members.length + data.invitations.length }} / {{ LIMITS.membersPerProduct }}</span
      ><v-spacer /><v-btn
        v-if="isAllowed(data.role, 'inviteOrRemoveMember')"
        :to="{ name: 'product-invite', params: { productId } }"
        variant="text"
        color="primary"
        size="small"
        :disabled="!online"
        >招待する</v-btn
      ></v-card-title
    >
    <v-card-text><OperationError :error="error" /></v-card-text>
    <v-list class="pt-0">
      <v-list-item
        v-for="member in members"
        :key="member.userId"
        :title="member.name"
        :subtitle="`参加 ${formatDate(new Date(member.joinedAt), 'yyyy/MM/dd')}`"
      >
        <template #prepend
          ><v-avatar color="primary-soft" size="32" class="text-primary mr-3">{{
            [...member.name][0]
          }}</v-avatar></template
        >
        <template #append
          ><RoleChip :role="member.role" />
          <v-menu v-if="Object.values(permissions(member)).some(Boolean)">
            <template #activator="{ props: activator }"
              ><v-btn
                v-bind="activator"
                icon="mdi-dots-vertical"
                variant="text"
                size="small"
                :disabled="!online || pending"
                :aria-label="`${member.name}の操作`"
            /></template>
            <v-list density="compact">
              <v-list-item
                v-if="permissions(member).promote"
                title="マネージャーに変更"
                @click="
                  succeeded(
                    actions.changeRole.mutateAsync({ userId: member.userId, role: 'manager' }),
                  )
                "
              />
              <v-list-item
                v-if="permissions(member).demote"
                title="メンバーに変更"
                @click="
                  succeeded(
                    actions.changeRole.mutateAsync({ userId: member.userId, role: 'member' }),
                  )
                "
              />
              <v-list-item
                v-if="permissions(member).transfer"
                title="オーナーを譲渡"
                @click="confirmation = { kind: 'transfer', member }"
              />
              <v-list-item
                v-if="permissions(member).remove"
                title="プロダクトから除外"
                base-color="error"
                @click="confirmation = { kind: 'remove', member }"
              />
            </v-list>
          </v-menu>
        </template>
      </v-list-item>
      <v-divider v-if="data.invitations.length" />
      <v-list-item
        v-for="invitation in data.invitations"
        :key="invitation.id"
        :title="invitation.email"
        :subtitle="`期限 ${formatDate(new Date(invitation.expiresAt), 'yyyy/MM/dd HH:mm')}`"
      >
        <template #append
          ><v-chip color="warning">仮登録</v-chip
          ><v-btn
            v-if="
              isAllowed(
                data.role,
                invitation.role === 'manager' ? 'inviteOrRemoveManager' : 'inviteOrRemoveMember',
              )
            "
            variant="text"
            size="small"
            :disabled="!online || pending || invitation.expiresAt <= Date.now()"
            @click="showCode(invitation.id)"
            >コード表示</v-btn
          ></template
        >
      </v-list-item>
    </v-list>
  </v-card>
  <v-dialog
    :model-value="!!confirmation"
    :persistent="pending"
    @update:model-value="
      (value) => {
        if (!value) confirmation = null
      }
    "
    ><v-card>
      <v-card-title>{{
        confirmation?.kind === 'transfer' ? 'オーナーを譲渡' : '参加者を除外'
      }}</v-card-title>
      <v-card-text
        ><OperationError :error="error" />
        <p>
          {{ confirmation?.member.name
          }}{{
            confirmation?.kind === 'transfer'
              ? 'さんにオーナーを譲渡しますか？あなたはマネージャーになります。'
              : 'さんをプロダクトから除外しますか？作成済みの設計・履歴は残ります。'
          }}
        </p></v-card-text
      >
      <v-card-actions
        ><v-spacer /><v-btn variant="outlined" :disabled="pending" @click="confirmation = null"
          >キャンセル</v-btn
        ><v-btn color="primary" :loading="pending" :disabled="!online" @click="confirm">{{
          confirmation?.kind === 'transfer' ? '譲渡する' : '除外する'
        }}</v-btn></v-card-actions
      >
    </v-card></v-dialog
  >
  <v-dialog
    :model-value="!!code"
    @update:model-value="
      (value) => {
        if (!value) code = null
      }
    "
    ><v-card
      ><v-card-title>招待コード</v-card-title
      ><v-card-text
        ><div class="font-mono text-h4 text-center my-4 text-primary text-selectable">
          {{ code?.passcode }}
        </div>
        <p class="text-body-2">
          有効期限 {{ code && formatDate(new Date(code.expiresAt), 'yyyy/MM/dd HH:mm') }}
        </p></v-card-text
      ><v-card-actions
        ><v-btn variant="outlined" @click="copy">コピー</v-btn><v-spacer /><v-btn
          @click="code = null"
          >閉じる</v-btn
        ></v-card-actions
      ></v-card
    ></v-dialog
  >
</template>
