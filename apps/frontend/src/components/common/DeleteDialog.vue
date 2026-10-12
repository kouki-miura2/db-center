<script setup lang="ts">
import { ref } from 'vue'
import { useDisplay } from 'vuetify'

import { useOnline } from '../../composables/useOnline.ts'
import { fieldError } from '../../forms/input.ts'
import FormField from './FormField.vue'
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
  <v-dialog
    v-model="open"
    :persistent="pending"
    :max-width="xs ? '100%' : step === 1 ? 448 : 488"
    :class="['design-dialog', 'delete-dialog', { 'bottom-sheet-dialog': xs }]"
  >
    <v-card>
      <div v-if="xs" class="sheet-handle" />
      <p class="delete-step">{{ step }} / 2</p>
      <v-card-title v-if="step === 1">{{ kind }}を削除しますか？</v-card-title>
      <v-card-title v-else class="delete-warning"
        ><v-icon color="error" size="24">mdi-alert-outline</v-icon
        >この操作は取り消せません</v-card-title
      >
      <v-card-text>
        <OperationError :error="error" @reload="$emit('reload')" />
        <template v-if="step === 1"
          ><p class="mb-3">「{{ props.name }}」を削除します。</p>
          <p class="screen-caption">{{ detail }}</p></template
        >
        <template v-else
          ><p class="mb-4">
            確認のため、{{ kind }}名 <strong>{{ props.name }}</strong> を入力してください。
          </p>
          <FormField v-slot="{ id }" :label="'確認のため' + kind + '名を入力'"
            ><v-text-field
              :id="id"
              v-model="confirmation"
              :error-messages="fieldError(error, 'confirmationName')"
              autocomplete="off"
              autofocus
              hide-details="auto" /></FormField
        ></template>
      </v-card-text>
      <v-card-actions
        ><v-spacer /><v-btn variant="text" :disabled="pending" @click="open = false"
          >キャンセル</v-btn
        ><v-btn v-if="step === 1" color="error" :disabled="!online" @click="step = 2"
          >削除の確認に進む</v-btn
        ><v-btn
          v-else
          color="error"
          prepend-icon="mdi-delete-forever-outline"
          :loading="pending"
          :disabled="!online || confirmation !== props.name"
          @click="$emit('confirm', confirmation)"
          >完全に削除する</v-btn
        ></v-card-actions
      >
    </v-card>
  </v-dialog>
</template>
