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
const { xs, smAndUp, mdAndUp } = useDisplay()
const tablet = computed(() => smAndUp.value && !mdAndUp.value)
const leave = async () => {
  if (await succeeded(mutation.leave.mutateAsync())) await router.replace({ name: 'products' })
}
</script>
<template>
  <v-container class="page"
    ><OperationError :error="query.error.value" @reload="query.refetch()" /><v-progress-linear
      v-if="query.isPending.value"
      indeterminate
    />
    <template v-if="data"
      ><div class="d-flex align-center flex-wrap ga-3 mb-6">
        <h1 class="text-h5 font-weight-bold text-break">{{ data.product.name }}</h1>
        <RoleChip :role="data.role" />
      </div>
      <v-row
        ><v-col cols="12" md="8" :order="tablet ? 2 : 1">
          <DatabaseList v-model:creating="creating" :product-id="productId" :data="data" />
        </v-col>
        <v-col cols="12" md="4" :order="tablet ? 1 : 2">
          <v-row
            ><v-col cols="12" sm="6" md="12"
              ><v-card
                ><v-card-title>プロダクト情報</v-card-title
                ><v-card-text
                  ><v-chip class="mb-4">{{ TARGETS[data.product.target].label }}</v-chip>
                  <h3 class="text-subtitle-2 mb-2">接続情報</h3>
                  <p v-if="!data.connections.length" class="text-body-2 text-medium-emphasis">
                    接続情報はありません。
                  </p>
                  <div v-for="connection in data.connections" :key="connection.id" class="mb-3">
                    <div class="font-weight-medium text-body-2">{{ connection.name }}</div>
                    <p class="font-mono text-caption text-break text-medium-emphasis">
                      {{ connection.connectionString }}
                    </p>
                  </div></v-card-text
                >
                <v-list density="compact"
                  ><v-list-item
                    v-if="isAllowed(data.role, 'renameProduct')"
                    :to="{ name: 'product-settings', params: { productId } }"
                    title="プロダクト設定"
                    prepend-icon="mdi-cog-outline" /><v-list-item
                    :to="{ name: 'product-history', params: { productId } }"
                    title="操作履歴"
                    prepend-icon="mdi-history" /><v-list-item
                    v-if="isAllowed(data.role, 'leaveProduct')"
                    title="プロダクトから退出"
                    prepend-icon="mdi-logout"
                    :disabled="!online"
                    @click="leaving = true"
                /></v-list> </v-card
            ></v-col>
            <v-col cols="12" sm="6" md="12"
              ><MemberList :product-id="productId" :data="data"
            /></v-col>
          </v-row>
        </v-col>
      </v-row>
      <div v-if="xs" class="mobile-actions">
        <v-btn
          v-if="isAllowed(data.role, 'renameProduct')"
          :to="{ name: 'product-settings', params: { productId } }"
          variant="outlined"
          prepend-icon="mdi-cog-outline"
          :disabled="!online"
          >設定</v-btn
        ><v-btn
          v-if="isAllowed(data.role, 'inviteOrRemoveMember')"
          :to="{ name: 'product-invite', params: { productId } }"
          variant="outlined"
          prepend-icon="mdi-account-plus-outline"
          :disabled="!online"
          >招待</v-btn
        ><v-btn
          v-if="isAllowed(data.role, 'manageDatabases')"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!online || data.databases.length >= LIMITS.databasesPerProduct"
          @click="creating = true"
          >DB作成</v-btn
        >
      </div>
    </template>
    <v-dialog v-model="leaving" :persistent="mutation.leave.isPending.value"
      ><v-card
        ><v-card-title>プロダクトから退出</v-card-title
        ><v-card-text
          ><OperationError :error="mutation.leave.error.value" />「{{
            data?.product.name
          }}」から退出しますか？作成済みの設計・履歴は残ります。</v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn
            variant="outlined"
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
      ></v-dialog
    >
  </v-container>
</template>
