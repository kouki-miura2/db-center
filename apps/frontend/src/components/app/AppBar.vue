<script setup lang="ts">
import { computed, ref } from 'vue'
import { type RouteLocationRaw, useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useSignOut } from '../../composables/useAuthMutations.ts'
import { useAuthStore } from '../../stores/auth.ts'
import WithdrawDialog from './WithdrawDialog.vue'

// The app bar (design `AppBar`): logo and breadcrumb on a PC, back button and screen name on a
// phone, and the signed-in user with the account menu (terms, privacy policy, sign out, withdraw).
const props = defineProps<{
  /** The screen's name after "プロダクト". */
  crumb?: string
  /** Where the back button of the compact bar goes. */
  back?: RouteLocationRaw
}>()

const auth = useAuthStore()
const { xs } = useDisplay()
const router = useRouter()
const signOut = useSignOut()
const withdrawing = ref(false)
const initial = computed(() => [...(auth.user?.name ?? '')][0] ?? '')

const leave = async () => {
  await signOut.mutateAsync()
  await router.replace({ name: 'login' })
}
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
      <v-menu v-if="auth.user" location="bottom end">
        <template #activator="{ props: activator }">
          <v-btn v-bind="activator" variant="text" class="px-1" aria-label="アカウントメニュー">
            <v-avatar
              size="30"
              color="primary-soft"
              class="text-primary-darken-1 font-weight-bold text-caption"
            >
              {{ initial }}
            </v-avatar>
            <span v-if="!xs" class="ml-2 text-body-2">{{ auth.user.name }}</span>
          </v-btn>
        </template>
        <v-list density="compact" min-width="240">
          <v-list-item :title="auth.user.name" :subtitle="auth.user.email" />
          <v-divider class="my-1" />
          <v-list-item
            :to="{ name: 'terms' }"
            prepend-icon="mdi-file-document-outline"
            title="利用規約"
          />
          <v-list-item
            :to="{ name: 'privacy' }"
            prepend-icon="mdi-shield-account-outline"
            title="プライバシーポリシー"
          />
          <v-divider class="my-1" />
          <v-list-item prepend-icon="mdi-logout" title="ログアウト" @click="leave" />
          <v-list-item
            prepend-icon="mdi-account-remove-outline"
            title="退会する"
            base-color="error"
            @click="withdrawing = true"
          />
        </v-list>
      </v-menu>
      <WithdrawDialog v-if="withdrawing" v-model="withdrawing" />
    </div>
  </v-app-bar>
</template>
