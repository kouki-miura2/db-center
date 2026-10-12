<script setup lang="ts">
import { useDisplay } from 'vuetify'

// The sign-in screens' frame (design 1a 1b, 2a 2b, 3a 3b): the dark brand panel beside the form
// on a PC, above it on a tablet or phone.
const { mdAndUp, xs } = useDisplay()
</script>

<template>
  <div class="auth-layout" :class="{ 'auth-layout--wide': mdAndUp }">
    <div class="auth-brand" :class="xs ? 'pa-6' : 'pa-10'">
      <div class="d-flex align-center ga-3">
        <div class="app-logo app-logo--inverse">db</div>
        <span class="text-subtitle-1 font-weight-bold">db-center</span>
      </div>
      <div :class="xs ? 'text-h6 mt-6' : 'text-h4 my-8'" class="font-weight-bold auth-tagline">
        データベース設計を、<br />プロダクト単位で一元管理。
      </div>
      <template v-if="!xs">
        <p class="text-body-2 auth-muted mb-6">
          バージョン管理された設計から、DDL・差分スクリプトの出力、接続先データベースへのビルドとマイグレーションまで。
        </p>
        <div class="d-flex ga-4 text-caption font-mono auth-muted">
          <span>PostgreSQL 18</span><span>SQLite 3</span>
        </div>
      </template>
    </div>
    <div class="auth-form" :class="xs ? 'pa-6' : 'pa-10'">
      <div class="auth-form__inner">
        <slot />
      </div>
    </div>
  </div>
</template>

<style scoped>
.auth-layout {
  min-height: 100dvh;
  display: grid;
  grid-template-rows: auto 1fr;
  background: rgb(var(--v-theme-surface));
}

.auth-layout--wide {
  grid-template-columns: 1fr 1fr;
  grid-template-rows: none;
}

.auth-brand {
  background: #16191f;
  color: #fff;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.auth-layout:not(.auth-layout--wide) .auth-brand {
  justify-content: flex-start;
}

.auth-tagline {
  line-height: 1.4 !important;
}

.auth-muted {
  color: #9aa0ab;
}

.app-logo--inverse {
  background: #fff;
  color: #16191f;
}

.auth-form {
  display: flex;
  align-items: center;
  justify-content: center;
}

.auth-form__inner {
  width: 100%;
  max-width: 380px;
  display: flex;
  flex-direction: column;
  gap: 24px;
}
</style>
