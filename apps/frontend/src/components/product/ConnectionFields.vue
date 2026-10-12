<script setup lang="ts">
import { LIMITS } from 'utils'
import { computed, ref } from 'vue'

import { useSortable } from '../../composables/useSortable.ts'
import { connectionDraft, type ConnectionDraft } from '../../forms/connections.ts'
import { fieldError, maxLength, required } from '../../forms/input.ts'
const props = defineProps<{ disabled: boolean; error: unknown; errorKey?: string }>()
const rows = defineModel<ConnectionDraft[]>({ required: true })
defineEmits<{ remove: [row: ConnectionDraft] }>()
const list = ref<HTMLElement>()
useSortable(
  list,
  rows,
  computed(() => props.disabled),
)
const move = (index: number, amount: number) => {
  const next = [...rows.value]
  const [row] = next.splice(index, 1)
  if (row) next.splice(index + amount, 0, row)
  rows.value = next
}
const errors = (row: ConnectionDraft, field: string) =>
  props.errorKey === row.key ? fieldError(props.error, field) : undefined
</script>
<template>
  <h2 class="text-subtitle-1 font-weight-bold mb-2">
    データベース接続情報
    <span class="text-medium-emphasis text-caption"
      >任意・{{ rows.length }} / {{ LIMITS.connectionsPerProduct }}</span
    >
  </h2>
  <p class="text-body-2 text-medium-emphasis mb-4">
    インターネットから接続でき、公的に信頼された認証局のTLS証明書を持つPostgreSQLに接続できます。パスワードは保存後に表示されません。
  </p>
  <div ref="list">
    <v-card v-for="(row, index) in rows" :key="row.key" data-sortable class="mb-3">
      <div class="d-flex align-center ga-1 px-3 pt-2">
        <v-btn
          class="drag-handle"
          variant="text"
          icon="mdi-drag"
          size="small"
          :disabled="disabled"
          aria-label="ドラッグで並べ替え"
        />
        <span class="text-body-2 font-weight-bold flex-grow-1">接続先 {{ index + 1 }}</span>
        <v-btn
          variant="text"
          icon="mdi-arrow-up"
          size="x-small"
          aria-label="上へ移動"
          :disabled="disabled || index === 0"
          @click="move(index, -1)"
        />
        <v-btn
          variant="text"
          icon="mdi-arrow-down"
          size="x-small"
          aria-label="下へ移動"
          :disabled="disabled || index === rows.length - 1"
          @click="move(index, 1)"
        />
        <v-btn
          variant="text"
          icon="mdi-delete-outline"
          size="small"
          color="error"
          aria-label="接続情報を削除"
          :disabled="disabled"
          @click="$emit('remove', row)"
        />
      </div>
      <v-card-text class="pt-3">
        <v-text-field
          v-model="row.name"
          label="接続名"
          :disabled="disabled"
          :rules="[required, maxLength(LIMITS.connectionNameMaxLength)]"
          :error-messages="errors(row, 'name')"
        />
        <v-text-field
          v-model="row.connectionString"
          label="接続文字列"
          :disabled="disabled"
          :rules="[required, maxLength(LIMITS.connectionStringMaxLength)]"
          :error-messages="errors(row, 'connectionString')"
        />
        <v-text-field
          v-model="row.password"
          type="password"
          autocomplete="new-password"
          :label="
            row.saved?.hasPassword ? 'パスワード（設定済み・変更する場合のみ入力）' : 'パスワード'
          "
          :disabled="disabled || row.removePassword"
          :error-messages="errors(row, 'password')"
          hide-details="auto"
        />
        <v-checkbox
          v-if="row.saved?.hasPassword"
          v-model="row.removePassword"
          label="設定済みのパスワードを削除する"
          :disabled="disabled"
          hide-details
        />
      </v-card-text>
    </v-card>
  </div>
  <v-btn
    variant="outlined"
    prepend-icon="mdi-plus"
    :disabled="disabled || rows.length >= LIMITS.connectionsPerProduct"
    @click="rows.push(connectionDraft())"
    >接続情報を追加</v-btn
  >
</template>
