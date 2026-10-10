<script setup lang="ts">
import { usePwaUpdate } from './composables/usePwaUpdate.ts'
import { useNotificationStore } from './stores/notification.ts'

const notification = useNotificationStore()
const { needRefresh, update } = usePwaUpdate()
const appTitle = import.meta.env.VITE_APP_TITLE
</script>

<template>
  <v-app>
    <v-app-bar :title="appTitle">
      <template #append>
        <v-btn to="/" text="Home" />
        <v-btn to="/sample" text="Sample" />
      </template>
    </v-app-bar>
    <v-main>
      <router-view />
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
