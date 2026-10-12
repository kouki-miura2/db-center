<script setup lang="ts">
import { useQueryClient } from '@tanstack/vue-query'
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import AppBar from './components/app/AppBar.vue'
import { useOnline } from './composables/useOnline.ts'
import { usePwaUpdate } from './composables/usePwaUpdate.ts'
import { useRevisionCheck } from './composables/useRevisionCheck.ts'
import { useNotificationStore } from './stores/notification.ts'

const route = useRoute()
const notification = useNotificationStore()
const online = useOnline()
const back = computed(() =>
  route.name === 'product' || !route.params.productId
    ? { name: 'products' }
    : { name: 'product', params: { productId: String(route.params.productId) } },
)
const { needRefresh, update } = usePwaUpdate()
useRevisionCheck(useQueryClient())
</script>

<template>
  <v-app>
    <AppBar
      v-if="!route.meta.public"
      :crumb="route.meta.crumb"
      :back="route.meta.crumb ? back : undefined"
    />
    <v-main>
      <v-alert
        v-if="!online"
        type="warning"
        variant="tonal"
        density="compact"
        rounded="0"
        icon="mdi-cloud-off-outline"
        text="オフラインです。表示しているのは最後に取得したデータで、変更はできません"
      />
      <router-view :key="route.path" />
    </v-main>
    <v-snackbar v-model="notification.visible">{{ notification.message }}</v-snackbar>
    <!-- A new version of the app: stays until tapped, behind any other message shown meanwhile. -->
    <v-snackbar :model-value="needRefresh && !notification.visible" :timeout="-1">
      新しいバージョンがあります
      <template #actions>
        <v-btn variant="text" @click="needRefresh = false">後で</v-btn>
        <v-btn variant="text" color="secondary" @click="update">更新</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>
