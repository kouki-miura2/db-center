<script setup lang="ts">
import { formatDate, isAllowed, LIMITS, TARGETS } from 'utils'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import OperationError from '../components/common/OperationError.vue'
import RoleChip from '../components/common/RoleChip.vue'
import { useOnline } from '../composables/useOnline.ts'
import { useProductListQuery } from '../composables/useProductListQuery.ts'
const query = useProductListQuery()
const products = computed(() => query.data.value?.data ?? [])
const online = useOnline()
const { xs, sm } = useDisplay()
const router = useRouter()
const date = (value: number) => formatDate(new Date(value), 'yyyy/MM/dd')
const select = (productId: string) => router.push({ name: 'product', params: { productId } })
const full = computed(() => products.value.length >= LIMITS.productsPerUser)
</script>

<template>
  <v-container class="page design-screen">
    <div class="screen-header">
      <div :class="xs ? 'd-flex align-center justify-space-between w-100' : ''">
        <h1 class="screen-title">プロダクト</h1>
        <p class="screen-caption">
          参加中 <span class="font-mono">{{ products.length }} / {{ LIMITS.productsPerUser }}</span>
        </p>
      </div>
      <v-spacer v-if="!xs" />
      <div :class="xs ? 'mobile-actions' : 'd-flex ga-3'">
        <v-btn
          :to="{ name: 'product-join' }"
          variant="outlined"
          prepend-icon="mdi-key-outline"
          :disabled="!online || full"
          >{{ xs ? '参加する' : 'プロダクトに参加' }}</v-btn
        >
        <v-btn
          :to="{ name: 'product-new' }"
          color="primary"
          prepend-icon="mdi-plus"
          :disabled="!online || full"
          >{{ xs ? '追加する' : 'プロダクトを追加' }}</v-btn
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
      <v-icon size="48" color="primary" class="mb-4">mdi-cube-outline</v-icon>
      <h2 class="text-subtitle-1 mb-2">参加中のプロダクトはありません</h2>
      <p class="screen-caption">プロダクトを追加するか、招待コードで参加してください。</p>
    </v-card>
    <div v-else-if="xs" class="d-flex flex-column ga-3">
      <v-card v-for="product in products" :key="product.id" class="product-mobile-card">
        <router-link
          :to="{ name: 'product', params: { productId: product.id } }"
          class="product-card-link"
        >
          <div class="d-flex align-center ga-2 mb-2">
            <h2 class="text-body-2 font-weight-bold text-break">{{ product.name }}</h2>
            <RoleChip :role="product.role" />
          </div>
          <p class="font-mono text-caption mb-1">{{ TARGETS[product.target].label }}</p>
          <p class="font-mono screen-caption">
            登録 {{ date(product.createdAt) }} ・ 参加 {{ date(product.joinedAt) }}
          </p>
        </router-link>
        <v-btn
          v-if="isAllowed(product.role, 'renameProduct')"
          :to="{ name: 'product-settings', params: { productId: product.id } }"
          icon="mdi-pencil-outline"
          variant="text"
          size="small"
          class="product-card-action"
          :aria-label="product.name + 'を編集'"
        />
        <v-icon v-else class="product-card-action" color="grey-lighten-1" size="20"
          >mdi-chevron-right</v-icon
        >
      </v-card>
    </div>
    <v-card v-else>
      <v-table class="design-table product-table"
        ><thead>
          <tr>
            <th>
              プロダクト名 <v-icon size="14">mdi-arrow-up</v-icon
              ><span v-if="sm"> / ターゲット</span>
            </th>
            <th v-if="!sm">ターゲット</th>
            <th>ロール</th>
            <th>登録日</th>
            <th>参加日</th>
            <th />
          </tr>
        </thead>
        <tbody>
          <tr v-for="product in products" :key="product.id" @click="select(product.id)">
            <td>
              <router-link
                :to="{ name: 'product', params: { productId: product.id } }"
                class="row-link d-flex align-center ga-3"
                @click.stop
                ><v-icon size="18" color="grey-darken-1">mdi-cube-outline</v-icon
                >{{ product.name }}</router-link
              >
              <p v-if="sm" class="font-mono screen-caption mt-1 ml-7">
                {{ TARGETS[product.target].label }}
              </p>
            </td>
            <td v-if="!sm" class="font-mono">{{ TARGETS[product.target].label }}</td>
            <td><RoleChip :role="product.role" /></td>
            <td class="font-mono text-caption">{{ date(product.createdAt) }}</td>
            <td class="font-mono text-caption">{{ date(product.joinedAt) }}</td>
            <td>
              <v-btn
                v-if="isAllowed(product.role, 'renameProduct')"
                :to="{ name: 'product-settings', params: { productId: product.id } }"
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                :aria-label="product.name + 'を編集'"
                @click.stop
              />
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>
    <p v-if="!xs && products.length" class="table-note">
      行の選択でデータベース一覧へ。編集ボタンはオーナー・マネージャーのプロダクトのみ表示。
    </p>
  </v-container>
</template>
