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
  {
    path: '/products/new',
    name: 'product-new',
    component: () => import('../views/ProductFormView.vue'),
    meta: { crumb: 'プロダクト登録' },
  },
  {
    path: '/products/join',
    name: 'product-join',
    component: () => import('../views/ProductJoinView.vue'),
    meta: { crumb: 'プロダクトに参加' },
  },
  {
    path: '/products/:productId',
    name: 'product',
    component: () => import('../views/ProductView.vue'),
    props: true,
    meta: { crumb: 'データベース' },
  },
  {
    path: '/products/:productId/settings',
    name: 'product-settings',
    component: () => import('../views/ProductFormView.vue'),
    props: true,
    meta: { crumb: 'プロダクト編集' },
  },
  {
    path: '/products/:productId/invite',
    name: 'product-invite',
    component: () => import('../views/ProductInviteView.vue'),
    props: true,
    meta: { crumb: 'ユーザー招待' },
  },
  {
    path: '/products/:productId/history',
    name: 'product-history',
    component: () => import('../views/ProductHistoryView.vue'),
    props: true,
    meta: { crumb: '操作履歴' },
  },
  {
    path: '/products/:productId/databases/:databaseId',
    name: 'database',
    component: () => import('../views/DatabaseOverviewView.vue'),
    props: true,
    meta: { crumb: 'データベース設計' },
  },
  {
    path: '/products/:productId/databases/:databaseId/history',
    name: 'database-history',
    component: () => import('../views/VersionHistoryView.vue'),
    props: true,
    meta: { crumb: 'バージョン履歴' },
  },
  {
    path: '/products/:productId/databases/:databaseId/versions/:versionId',
    name: 'design',
    component: () => import('../views/DatabaseOverviewView.vue'),
    props: true,
    meta: { crumb: 'データベース設計' },
  },
  {
    path: '/products/:productId/databases/:databaseId/versions/:versionId/objects/:objectKey',
    name: 'design-object',
    component: () => import('../views/DatabaseOverviewView.vue'),
    props: true,
    meta: { crumb: 'データベース設計' },
  },
  { path: '/:pathMatch(.*)*', redirect: { name: 'products' } },
]
