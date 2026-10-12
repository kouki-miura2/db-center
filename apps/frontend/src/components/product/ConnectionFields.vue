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
const connectionPlaceholder = 'postgresql://app@host:5432/db'
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
  <h2 class="form-card-title">
    データベース接続情報 <span class="screen-caption ml-2 font-weight-regular">任意</span>
  </h2>
  <div ref="list">
    <div v-for="(row, index) in rows" :key="row.key" data-sortable class="connection-row">
      <div class="connection-inputs">
        <div class="form-field">
          <label :for="row.key + '-name'" class="field-label">接続名</label
          ><v-text-field
            :id="row.key + '-name'"
            v-model="row.name"
            aria-label="接続名"
            placeholder="接続名（例: 本番）"
            :disabled="disabled"
            :rules="[required, maxLength(LIMITS.connectionNameMaxLength)]"
            :error-messages="errors(row, 'name')"
            hide-details="auto"
          />
        </div>
        <div class="form-field">
          <label :for="row.key + '-connection'" class="field-label">接続文字列</label
          ><v-text-field
            :id="row.key + '-connection'"
            v-model="row.connectionString"
            aria-label="接続文字列"
            :placeholder="connectionPlaceholder"
            class="font-mono"
            :disabled="disabled"
            :rules="[required, maxLength(LIMITS.connectionStringMaxLength)]"
            :error-messages="errors(row, 'connectionString')"
            hide-details="auto"
          />
        </div>
        <div class="form-field">
          <label :for="row.key + '-password'" class="field-label"
            >パスワード<span
              v-if="row.saved?.hasPassword && !row.removePassword"
              class="text-success ml-1"
              ><v-icon size="12">mdi-check-circle-outline</v-icon> 設定済み</span
            ><span v-if="row.removePassword" class="text-error ml-1">保存時に削除</span></label
          >
          <v-text-field
            :id="row.key + '-password'"
            v-model="row.password"
            aria-label="パスワード"
            type="password"
            :placeholder="row.saved ? '変更する場合のみ入力' : 'パスワード（任意）'"
            autocomplete="new-password"
            :disabled="disabled || row.removePassword"
            :error-messages="errors(row, 'password')"
            hide-details="auto"
            ><template #append-inner
              ><v-menu v-if="row.saved?.hasPassword"
                ><template #activator="{ props: menu }"
                  ><v-btn
                    v-bind="menu"
                    :icon="row.removePassword ? 'mdi-lock-off-outline' : 'mdi-lock-outline'"
                    variant="text"
                    size="x-small"
                    :disabled="disabled"
                    aria-label="保存済みパスワードの操作" /></template
                ><v-list density="compact"
                  ><v-list-item
                    :title="
                      row.removePassword ? 'パスワードの削除を取り消す' : '保存済みパスワードを削除'
                    "
                    @click="row.removePassword = !row.removePassword" /></v-list></v-menu
              ><v-icon v-else size="16" color="grey">mdi-lock-outline</v-icon></template
            ></v-text-field
          >
        </div>
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          size="small"
          class="connection-remove"
          aria-label="接続情報を削除"
          :disabled="disabled"
          @click="$emit('remove', row)"
        />
      </div>
      <div v-if="rows.length > 1" class="connection-reorder">
        <v-btn
          class="drag-handle"
          variant="text"
          icon="mdi-drag"
          size="x-small"
          :disabled="disabled"
          aria-label="ドラッグで並べ替え"
        />
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
      </div>
    </div>
  </div>
  <v-btn
    variant="outlined"
    class="connection-add"
    prepend-icon="mdi-plus"
    :disabled="disabled || rows.length >= LIMITS.connectionsPerProduct"
    @click="rows.push(connectionDraft())"
    >接続情報を追加</v-btn
  >
  <p class="field-hint mt-4">パスワードは保存後、どのロールにも表示されません。</p>
  <p class="field-hint">
    インターネットから接続でき、公的な認証局の TLS 証明書を持つ PostgreSQL
    だけ接続できます。自己署名・独自の認証局の証明書のデータベースには、出力したスクリプトを実行してください。
  </p>
</template>
