<script setup lang="ts">
import { formatDate, isAllowed, LIMITS, TARGETS } from 'utils'
import { computed } from 'vue'
import { useDisplay } from 'vuetify'

import OperationError from '../components/common/OperationError.vue'
import RoleChip from '../components/common/RoleChip.vue'
import { useOnline } from '../composables/useOnline.ts'
import { useProductListQuery } from '../composables/useProductListQuery.ts'
const query = useProductListQuery()
const products = computed(() => query.data.value?.data ?? [])
const online = useOnline()
const { xs } = useDisplay()
const full = computed(() => products.value.length >= LIMITS.productsPerUser)
</script>

<template>
  <v-container class="page">
    <div class="d-flex align-center flex-wrap ga-3 mb-6">
      <h1 class="text-h5 font-weight-bold">プロダクト</h1>
      <v-chip>{{ `参加中 ${products.length} / ${LIMITS.productsPerUser}` }}</v-chip>
      <v-spacer />
      <div :class="xs ? 'mobile-actions' : 'd-flex ga-2'">
        <v-btn
          :to="{ name: 'product-join' }"
          variant="outlined"
          prepend-icon="mdi-account-plus-outline"
          :disabled="!online || full"
          >プロダクトに参加</v-btn
        >
        <v-btn
          :to="{ name: 'product-new' }"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!online || full"
          >プロダクトを追加</v-btn
        >
      </div>
    </div>
    <OperationError :error="query.error.value" @reload="query.refetch()" />
    <v-progress-linear
      v-if="query.isPending.value"
      indeterminate
      color="primary"
      aria-label="読み込み中"
    />
    <v-card v-else-if="products.length === 0" class="text-center pa-10">
      <v-icon size="48" color="primary" class="mb-4">mdi-folder-open-outline</v-icon>
      <h2 class="text-subtitle-1 mb-2">参加中のプロダクトはありません</h2>
      <p class="text-body-2 text-medium-emphasis">
        プロダクトを追加するか、招待コードで参加してください。
      </p>
    </v-card>
    <div v-else-if="xs" class="d-flex flex-column ga-3">
      <v-card
        v-for="product in products"
        :key="product.id"
        :to="{ name: 'product', params: { productId: product.id } }"
      >
        <v-card-text>
          <div class="d-flex align-center ga-2 mb-3">
            <v-icon color="primary">mdi-folder-outline</v-icon>
            <h2 class="text-subtitle-1 font-weight-bold flex-grow-1 text-break">
              {{ product.name }}
            </h2>
            <v-icon>mdi-chevron-right</v-icon>
          </div>
          <div class="d-flex ga-2 align-center mb-3">
            <v-chip>{{ TARGETS[product.target].label }}</v-chip
            ><RoleChip :role="product.role" />
          </div>
          <div class="d-flex justify-space-between text-caption text-medium-emphasis">
            <span>登録 {{ formatDate(new Date(product.createdAt), 'yyyy/MM/dd') }}</span
            ><span>参加 {{ formatDate(new Date(product.joinedAt), 'yyyy/MM/dd') }}</span>
          </div>
          <v-btn
            v-if="isAllowed(product.role, 'renameProduct')"
            :to="{ name: 'product-settings', params: { productId: product.id } }"
            variant="text"
            size="small"
            class="mt-2"
            prepend-icon="mdi-pencil-outline"
            @click.stop
            >編集</v-btn
          >
        </v-card-text>
      </v-card>
    </div>
    <v-card v-else>
      <v-table
        ><thead>
          <tr>
            <th>プロダクト名</th>
            <th>ターゲット</th>
            <th>ロール</th>
            <th>登録日</th>
            <th>参加日</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in products" :key="product.id">
            <td>
              <router-link
                :to="{ name: 'product', params: { productId: product.id } }"
                class="font-weight-bold"
                >{{ product.name }}</router-link
              >
            </td>
            <td>{{ TARGETS[product.target].label }}</td>
            <td><RoleChip :role="product.role" /></td>
            <td class="font-mono text-caption">
              {{ formatDate(new Date(product.createdAt), 'yyyy/MM/dd') }}
            </td>
            <td class="font-mono text-caption">
              {{ formatDate(new Date(product.joinedAt), 'yyyy/MM/dd') }}
            </td>
            <td>
              <v-btn
                v-if="isAllowed(product.role, 'renameProduct')"
                :to="{ name: 'product-settings', params: { productId: product.id } }"
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                aria-label="プロダクトを編集"
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
  </v-container>
</template>
