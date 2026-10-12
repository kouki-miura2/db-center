<script setup lang="ts">
import { ref } from 'vue'
import { useDisplay } from 'vuetify'

import { useOnline } from '../../composables/useOnline.ts'
import { fieldError } from '../../forms/input.ts'
import OperationError from './OperationError.vue'
const props = defineProps<{
  name: string
  kind: string
  detail: string
  pending: boolean
  error: unknown
}>()
const open = defineModel<boolean>({ required: true })
defineEmits<{ confirm: [name: string]; reload: [] }>()
const step = ref(1)
const confirmation = ref('')
const online = useOnline()
const { xs } = useDisplay()
</script>
<template>
  <v-dialog v-model="open" :fullscreen="xs" :persistent="pending">
    <v-card>
      <v-card-title class="d-flex align-center ga-2"
        ><v-icon color="error">mdi-alert-circle-outline</v-icon>{{ kind }}を削除{{
          step === 2 ? '（最終確認）' : ''
        }}</v-card-title
      >
      <v-card-text>
        <OperationError :error="error" @reload="$emit('reload')" />
        <p class="font-weight-bold mb-3">「{{ props.name }}」を削除しますか？</p>
        <p class="text-body-2 mb-4">{{ detail }} この操作は画面から元に戻せません。</p>
        <v-text-field
          v-if="step === 2"
          v-model="confirmation"
          :label="`確認のため${kind}名を入力`"
          :error-messages="fieldError(error, 'confirmationName')"
          autocomplete="off"
          autofocus
        />
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="outlined" :disabled="pending" @click="open = false"
          >キャンセル</v-btn
        >
        <v-btn v-if="step === 1" color="error" :disabled="!online" @click="step = 2"
          >削除の確認に進む</v-btn
        >
        <v-btn
          v-else
          color="error"
          :loading="pending"
          :disabled="!online || confirmation !== props.name"
          @click="$emit('confirm', confirmation)"
          >完全に削除する</v-btn
        >
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
