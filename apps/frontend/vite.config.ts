import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import vuetify from 'vite-plugin-vuetify'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    // Vitest v4 compatibility: preserve mock call history.
    // Remove after tests no longer rely on calls from setup or earlier tests.
    // https://viteplus.dev/guide/vitest-v5#remove-unneeded-compatibility-settings
    // https://vitest.dev/guide/migration/#clearmocks-is-enabled-by-default
    clearMocks: false,
  },
  plugins: [
    vue(),
    vuetify({ autoImport: true }),
    // Service worker: detects a new build and waits for the person to tap "更新"
    // (`registerType: 'prompt'`, `usePwaUpdate`). `/api` is never cached. Off in `vp dev`.
    VitePWA({
      registerType: 'prompt',
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        // The SPA fallback must not answer the API.
        navigateFallbackDenylist: [/^\/api\//],
      },
      // PWA (home screen install) not needed: no manifest. Set one here to make it installable.
      manifest: false,
    }),
  ],
  // Dev only. Vuetify's auto-imported components are added at transform time, so Vite's dependency
  // scan can't see them; pre-bundling them lazily would re-optimize and reload the page on the
  // first visit to a lazy route that uses a new component (the navigation seems to do nothing).
  // Serving vuetify unbundled avoids that reload.
  optimizeDeps: {
    exclude: ['vuetify'],
  },
  // Same layout as production: frontend at `/`, backend at `/api` (backend dev server on 8787).
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
})
