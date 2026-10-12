<script setup lang="ts">
import { computed } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useAuthStore } from '../../stores/auth.ts'

// The app bar (design `AppBar`): logo and breadcrumb on a PC, back button and screen name on a
// phone, and the signed-in user.
const props = defineProps<{
  /** The screen's name after "プロダクト". */
  crumb?: string
  /** Where the back button of the compact bar goes. */
  back?: RouteLocationRaw
}>()

const auth = useAuthStore()
const { xs } = useDisplay()
const initial = computed(() => [...(auth.user?.name ?? '')][0] ?? '')
</script>

<template>
  <v-app-bar flat border="b" height="56" color="surface">
    <div class="d-flex align-center ga-3 px-4 w-100">
      <template v-if="xs">
        <v-btn
          v-if="props.back"
          :to="props.back"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
        />
        <div v-else class="app-logo">db</div>
        <span class="text-subtitle-2 font-weight-bold text-truncate flex-grow-1">
          {{ props.crumb ?? 'db-center' }}
        </span>
      </template>
      <template v-else>
        <router-link :to="{ name: 'products' }" class="d-flex align-center ga-2 text-high-emphasis">
          <div class="app-logo">db</div>
          <span class="text-subtitle-2 font-weight-bold">db-center</span>
        </router-link>
        <v-divider vertical class="my-4" />
        <v-breadcrumbs density="compact" class="text-body-2 pa-0 flex-grow-1">
          <v-breadcrumbs-item :to="{ name: 'products' }" prepend-icon="mdi-folder-open-outline">
            プロダクト
          </v-breadcrumbs-item>
          <template v-if="props.crumb">
            <v-breadcrumbs-divider icon="mdi-chevron-right" />
            <v-breadcrumbs-item class="text-high-emphasis font-weight-medium">
              {{ props.crumb }}
            </v-breadcrumbs-item>
          </template>
        </v-breadcrumbs>
      </template>
      <div v-if="auth.user" class="d-flex align-center ga-2 text-body-2">
        <v-avatar
          size="30"
          color="primary-soft"
          class="text-primary-darken-1 font-weight-bold text-caption"
        >
          {{ initial }}
        </v-avatar>
        <span v-if="!xs">{{ auth.user.name }}</span>
      </div>
    </div>
  </v-app-bar>
</template>
