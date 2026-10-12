<script setup lang="ts">
import { isAllowed, TARGETS, LIMITS } from 'utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { succeeded } from '../api/call.ts'
import OperationError from '../components/common/OperationError.vue'
import RoleChip from '../components/common/RoleChip.vue'
import DatabaseList from '../components/database/DatabaseList.vue'
import MemberList from '../components/product/MemberList.vue'
import ProductInfo from '../components/product/ProductInfo.vue'
import { useMemberMutations } from '../composables/useMemberMutations.ts'
import { useOnline } from '../composables/useOnline.ts'
import { useProductQuery } from '../composables/useProductQuery.ts'
const props = defineProps<{ productId: string }>()
const query = useProductQuery(props.productId)
const data = computed(() => query.data.value?.data)
const mutation = useMemberMutations(props.productId)
const online = useOnline()
const router = useRouter()
const leaving = ref(false)
const creating = ref(false)
const { xs, sm } = useDisplay()
const information = ref(false)
const participants = ref(false)
const leave = async () => {
  if (await succeeded(mutation.leave.mutateAsync())) await router.replace({ name: 'products' })
}
</script>
<template>
  <v-container class="page database-page design-screen">
    <OperationError :error="query.error.value" @reload="query.refetch()" />
    <v-progress-linear v-if="query.isPending.value" indeterminate />
    <template v-if="data">
      <div v-if="xs" class="product-summary">
        <RoleChip :role="data.role" />
        <v-chip variant="outlined" class="font-mono">{{
          TARGETS[data.product.target].label
        }}</v-chip>
        <v-chip variant="outlined" @click="information = true"
          ><span class="connection-dot" />接続 {{ data.connections.length }}</v-chip
        >
        <v-chip
          variant="outlined"
          prepend-icon="mdi-account-multiple-outline"
          @click="participants = true"
          >{{ data.members.length + data.invitations.length }} /
          {{ LIMITS.membersPerProduct }}</v-chip
        >
        <v-menu
          ><template #activator="{ props: menu }"
            ><v-btn
              v-bind="menu"
              icon="mdi-dots-vertical"
              size="x-small"
              variant="text"
              aria-label="プロダクトの操作" /></template
          ><v-list density="compact"
            ><v-list-item
              :to="{ name: 'product-history', params: { productId } }"
              title="操作履歴" /><v-list-item
              v-if="isAllowed(data.role, 'leaveProduct')"
              title="プロダクトから退出"
              :disabled="!online"
              @click="leaving = true" /></v-list
        ></v-menu>
      </div>
      <div class="database-layout">
        <div class="screen-header database-heading">
          <div>
            <div v-if="!xs" class="d-flex align-center ga-3">
              <h1 class="screen-title text-break">{{ data.product.name }}</h1>
              <RoleChip :role="data.role" />
            </div>
            <p class="screen-caption">データベース {{ data.databases.length }}件</p>
          </div>
          <v-spacer />
          <v-btn
            v-if="!xs && isAllowed(data.role, 'manageDatabases')"
            color="primary"
            prepend-icon="mdi-plus"
            :disabled="!online || data.databases.length >= LIMITS.databasesPerProduct"
            @click="creating = true"
            >データベースを作成</v-btn
          >
        </div>
        <aside v-if="!xs" class="product-sidebar">
          <ProductInfo :product-id="productId" :data="data" @leave="leaving = true" />
          <MemberList
            :product-id="productId"
            :data="data"
            :summary="sm"
            @expand="participants = true"
          />
        </aside>
        <div class="database-list-area">
          <DatabaseList v-model:creating="creating" :product-id="productId" :data="data" />
        </div>
      </div>
      <div v-if="xs" class="mobile-actions database-mobile-actions">
        <v-btn
          v-if="isAllowed(data.role, 'renameProduct')"
          :to="{ name: 'product-settings', params: { productId } }"
          variant="outlined"
          icon="mdi-cog-outline"
          aria-label="プロダクト設定"
          :disabled="!online"
        />
        <v-btn
          v-if="isAllowed(data.role, 'inviteOrRemoveMember')"
          :to="{ name: 'product-invite', params: { productId } }"
          variant="outlined"
          prepend-icon="mdi-account-plus-outline"
          :disabled="!online"
          >招待</v-btn
        >
        <v-btn
          v-if="isAllowed(data.role, 'manageDatabases')"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!online || data.databases.length >= LIMITS.databasesPerProduct"
          @click="creating = true"
          >DB作成</v-btn
        >
      </div>
      <v-dialog v-if="information" v-model="information" max-width="560"
        ><ProductInfo :product-id="productId" :data="data" @leave="leaving = true" /><v-btn
          class="mt-2"
          @click="information = false"
          >閉じる</v-btn
        ></v-dialog
      >
      <v-dialog v-if="participants" v-model="participants" max-width="560"
        ><MemberList :product-id="productId" :data="data" /><v-btn
          class="mt-2"
          @click="participants = false"
          >閉じる</v-btn
        ></v-dialog
      >
    </template>
    <v-dialog
      v-model="leaving"
      :persistent="mutation.leave.isPending.value"
      class="design-dialog"
      max-width="448"
    >
      <v-card
        ><v-card-title>プロダクトから退出</v-card-title
        ><v-card-text
          ><OperationError :error="mutation.leave.error.value" />「{{
            data?.product.name
          }}」から退出しますか？作成済みの設計・履歴は残ります。</v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn
            variant="text"
            :disabled="mutation.leave.isPending.value"
            @click="leaving = false"
            >キャンセル</v-btn
          ><v-btn
            color="primary"
            :disabled="!online"
            :loading="mutation.leave.isPending.value"
            @click="leave"
            >退出する</v-btn
          ></v-card-actions
        ></v-card
      >
    </v-dialog>
  </v-container>
</template>
