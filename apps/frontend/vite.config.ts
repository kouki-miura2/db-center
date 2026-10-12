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
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        // Keep enough headroom for self-hosted Japanese fonts and generated chunks.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // The PDF export's libraries (jsPDF and its optional canvg, html2canvas, DOMPurify) load
        // only when a PDF is made, which needs to be online anyway: don't make every device fetch
        // them up front. Its TTF fonts aren't matched by `globPatterns` either.
        globIgnores: ['**/jspdf*.js', '**/html2canvas*.js', '**/purify*.js', '**/index.es-*.js'],
        // The icon font is requested as `…woff2?v=7.4.47` (@mdi/font's CSS) but precached without
        // the query: ignore `v` (besides the defaults), or the icons are blank offline.
        ignoreURLParametersMatching: [/^utm_/, /^fbclid$/, /^v$/],
        // The SPA fallback must not answer the API.
        navigateFallbackDenylist: [/^\/api\//],
      },
      manifest: {
        id: '/',
        name: 'db-center',
        short_name: 'db-center',
        description: 'データベースの設計・バージョン管理・ビルド・マイグレーション',
        lang: 'ja',
        start_url: '/products',
        scope: '/',
        display: 'standalone',
        theme_color: '#2F55D4',
        background_color: '#F4F5F7',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
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
