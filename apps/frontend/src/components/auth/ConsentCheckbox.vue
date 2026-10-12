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
  <v-sheet border rounded="lg" class="px-2">
    <v-checkbox v-model="agreed" hide-details>
      <template #label>
        <span class="text-body-2">
          <a :href="terms" target="_blank" rel="noopener" @click.stop>利用規約</a>
          と
          <a :href="privacy" target="_blank" rel="noopener" @click.stop>プライバシーポリシー</a>
          に同意する
        </span>
      </template>
    </v-checkbox>
  </v-sheet>
</template>
