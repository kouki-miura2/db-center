import type { RouteRecordRaw } from 'vue-router'

declare module 'vue-router' {
  interface RouteMeta {
    /** Open without signing in (sign-in, terms, privacy policy). No app bar. */
    public?: boolean
    /** The consent screen: the only one a user who must agree to new terms can open. */
    consent?: boolean
    /** The screen's name after "プロダクト" in the app bar. */
    crumb?: string
  }
}

// The screens of `docs/frontend-implementation.md` "3. ルーティング", added phase by phase.
export const routes: RouteRecordRaw[] = [
  { path: '/', redirect: { name: 'products' } },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true },
  },
  {
    path: '/terms',
    name: 'terms',
    component: () => import('../views/LegalView.vue'),
    props: { kind: 'terms' },
    meta: { public: true },
  },
  {
    path: '/privacy',
    name: 'privacy',
    component: () => import('../views/LegalView.vue'),
    props: { kind: 'privacy' },
    meta: { public: true },
  },
  {
    path: '/consent',
    name: 'consent',
    component: () => import('../views/ConsentView.vue'),
    meta: { consent: true },
  },
  {
    path: '/products',
    name: 'products',
    component: () => import('../views/ProductListView.vue'),
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'products' } },
]
