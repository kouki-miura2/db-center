<script setup lang="ts">
import { useDisplay } from 'vuetify'

// docs/design: 1a/1b (PC), 2a/2b (tablet), 3a/3b (phone).
defineProps<{ registration?: boolean }>()
const { mdAndUp, xs } = useDisplay()
</script>
<template>
  <div
    class="auth-layout"
    :class="{ 'auth-layout--wide': mdAndUp, 'auth-layout--registration': registration }"
  >
    <div class="auth-brand">
      <div class="auth-brand__logo">
        <div class="app-logo app-logo--inverse">db</div>
        <span>db-center</span>
      </div>
      <div class="auth-brand__message">
        <div class="auth-tagline">データベース設計を、<br />プロダクト単位で一元管理。</div>
        <p v-if="!xs && !registration" class="auth-description">
          バージョン管理された設計から、DDL・差分スクリプトの出力、接続先データベースへのビルドとマイグレーションまで。
        </p>
      </div>
      <div v-if="mdAndUp" class="auth-targets font-mono">
        <span>PostgreSQL 18</span><span>SQLite 3</span>
      </div>
    </div>
    <div class="auth-form">
      <div class="auth-form__inner"><slot /></div>
      <slot name="development" />
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
  color: white;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 56px;
}
.auth-brand__logo {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 17px;
  font-weight: 600;
  line-height: 1.5;
}
.auth-brand__message {
  display: flex;
  flex-direction: column;
  gap: 20px;
}
.auth-tagline {
  font-size: 36px;
  font-weight: 600;
  line-height: 1.4;
  text-wrap: pretty;
}
.auth-description {
  max-width: 420px;
  margin: 0;
  font-size: 15px;
  line-height: 1.8;
  color: #b9bec8;
}
.auth-targets {
  display: flex;
  gap: 16px;
  font-size: 12px;
  line-height: 1.25;
  color: #7c8390;
}
.app-logo--inverse {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: white;
  color: #16191f;
  font-size: 13px;
}
.auth-form {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px;
  min-width: 0;
}
.auth-form__inner {
  width: 100%;
  max-width: 380px;
}
@media (min-width: 600px) and (max-width: 959px) {
  .auth-brand {
    padding: 64px 72px 56px;
    gap: 40px;
  }
  .auth-brand__message {
    gap: 40px;
  }
  .auth-tagline {
    font-size: 34px;
  }
  .auth-description {
    max-width: 520px;
  }
  .auth-form {
    justify-content: flex-start;
    padding: 72px 40px 40px;
  }
  .auth-form__inner {
    max-width: 420px;
  }
  .auth-layout--registration .auth-brand {
    padding: 40px 72px;
  }
  .auth-layout--registration .auth-brand__message {
    display: none;
  }
  .auth-layout--registration .auth-form__inner {
    max-width: 440px;
  }
}
@media (max-width: 599px) {
  .auth-brand {
    padding: 56px 24px 36px;
    gap: 28px;
  }
  .auth-brand__logo {
    font-size: 16px;
  }
  .app-logo--inverse {
    width: 30px;
    height: 30px;
    font-size: 12px;
  }
  .auth-tagline {
    font-size: 24px;
    line-height: 1.45;
  }
  .auth-form {
    align-items: stretch;
    justify-content: flex-start;
    padding: 28px 24px;
  }
  .auth-form__inner {
    display: flex;
    flex: 1;
    max-width: none;
  }
  .auth-layout--registration .auth-brand {
    height: 56px;
    padding: 0 20px;
    justify-content: center;
    background: white;
    color: #16191f;
    border-bottom: 1px solid #e3e5ea;
  }
  .auth-layout--registration .auth-brand__logo {
    font-size: 15px;
  }
  .auth-layout--registration .app-logo--inverse {
    width: 28px;
    height: 28px;
    border-radius: 7px;
    background: #16191f;
    color: white;
  }
  .auth-layout--registration .auth-brand__message {
    display: none;
  }
  .auth-layout--registration .auth-form {
    padding: 24px 20px 28px;
  }
}
</style>
