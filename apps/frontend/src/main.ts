import { VueQueryPlugin } from '@tanstack/vue-query'
import { createPinia } from 'pinia'
import { createApp } from 'vue'

import App from './App.vue'
import { listenForAuthErrors } from './auth/session.ts'
import { queryClient } from './plugins/query.ts'
import { vuetify } from './plugins/vuetify.ts'
import { router } from './router/index.ts'

import './styles.css'

listenForAuthErrors(queryClient, router)

createApp(App)
  .use(createPinia())
  .use(router)
  .use(vuetify)
  .use(VueQueryPlugin, { queryClient })
  .mount('#app')
