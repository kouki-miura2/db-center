<script setup lang="ts">
import { useRouter } from 'vue-router'

// "利用規約 と プライバシーポリシー に同意する". The links open in a new tab: the screen holds
// the sign-in in progress (`docs/agents/public-app.md`).
const agreed = defineModel<boolean>({ required: true })
const router = useRouter()
const terms = router.resolve({ name: 'terms' }).href
const privacy = router.resolve({ name: 'privacy' }).href
</script>

<template>
  <v-sheet border rounded="lg" class="consent-box">
    <v-checkbox v-model="agreed" hide-details>
      <template #label>
        <span class="consent-label">
          <a :href="terms" target="_blank" rel="noopener" @click.stop>利用規約</a>
          と
          <a :href="privacy" target="_blank" rel="noopener" @click.stop>プライバシーポリシー</a>
          に同意する
        </span>
      </template>
    </v-checkbox>
  </v-sheet>
</template>

<style scoped>
.consent-box {
  padding: 10px 14px;
  border-color: #e3e5ea;
}
.consent-label {
  font-size: 13px;
  line-height: 1.7;
}
.consent-box :deep(.v-selection-control) {
  min-height: 28px;
  align-items: flex-start;
}
.consent-box :deep(.v-selection-control__wrapper) {
  width: 20px;
  height: 24px;
  margin-right: 10px;
}
.consent-box :deep(.v-selection-control__input) {
  width: 24px;
  height: 24px;
}
.consent-box :deep(.v-icon) {
  font-size: 22px;
}
.consent-box :deep(.v-label) {
  opacity: 1;
}
</style>
