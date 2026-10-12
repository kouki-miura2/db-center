<script setup lang="ts">
import { isDatabaseName, LIMITS } from 'utils'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDisplay } from 'vuetify'

import { useDatabaseMutations } from '../../composables/useDatabaseMutations.ts'
import { useDatabaseQuery } from '../../composables/useDatabaseQuery.ts'
import { useOnline } from '../../composables/useOnline.ts'
import { useProductQuery } from '../../composables/useProductQuery.ts'
import type { ProductData } from '../../composables/useProductQuery.ts'
import { fieldError, maxLength, required } from '../../forms/input.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import OperationError from '../common/OperationError.vue'

const props = defineProps<{
  productId: string
  databases: ProductData['databases']
  database?: ProductData['databases'][number]
}>()
const open = defineModel<boolean>({ required: true })
const mutation = useDatabaseMutations(props.productId)
const router = useRouter()
const online = useOnline()
const { xs } = useDisplay()
const notification = useNotificationStore()
const product = useProductQuery(props.productId)
const original = ref(props.database)
const reload = async () => {
  await product.refetch()
  const fresh = product.data.value?.data.databases.find(
    (database) => database.id === original.value?.id,
  )
  if (!fresh) return
  original.value = fresh
  name.value = fresh.name
  description.value = fresh.description ?? ''
  mutation.rename.reset()
}
const name = ref(props.database?.name ?? '')
const description = ref(props.database?.description ?? '')
const initial = ref('empty')
const sourceDatabaseId = ref('')
const sourceVersionId = ref('')
const source = useDatabaseQuery(props.productId, sourceDatabaseId)
const finalVersions = computed(
  () => source.data.value?.data.versions.filter((version) => version.status === 'final') ?? [],
)
const valid = ref(false)
const pending = computed(() => mutation.create.isPending.value || mutation.rename.isPending.value)
const error = computed(() => mutation.create.error.value ?? mutation.rename.error.value)
const cloneItems = computed(() =>
  props.databases
    .filter((database) => database.latestFinalVersion)
    .map((database) => ({ value: database.id, title: database.name })),
)
const save = async () => {
  if (
    !online.value ||
    !valid.value ||
    (initial.value === 'clone' &&
      !finalVersions.value.some((version) => version.id === sourceVersionId.value))
  )
    return
  try {
    if (original.value) {
      await mutation.rename.mutateAsync({
        databaseId: original.value.id,
        json: {
          name: name.value.trim(),
          description: description.value.trim(),
          expectedUpdatedAt: original.value.updatedAt,
        },
      })
      open.value = false
      notification.show('データベースを更新しました')
    } else {
      const database = await mutation.create.mutateAsync({
        name: name.value.trim(),
        description: description.value.trim(),
        ...(initial.value === 'clone' ? { sourceVersionId: sourceVersionId.value } : {}),
      })
      open.value = false
      notification.show('データベースを作成しました')
      await router.push({
        name: 'design',
        params: {
          productId: props.productId,
          databaseId: database.id,
          versionId: database.latestVersion.id,
        },
      })
    }
  } catch {
    /* Shown in the form. */
  }
}
</script>
<template>
  <v-dialog v-model="open" :fullscreen="xs" :persistent="pending">
    <v-card
      ><v-card-title>{{
        database ? 'データベースの名前・説明を変更' : 'データベースを作成'
      }}</v-card-title>
      <v-form v-model="valid" @submit.prevent="save"
        ><v-card-text>
          <OperationError :error="error" @reload="reload" />
          <v-text-field
            v-model="name"
            label="データベース名 *"
            autofocus
            :disabled="!online || pending"
            :rules="[
              required,
              (value: string) =>
                isDatabaseName(value.trim()) ||
                '英小文字で始まり、英小文字・数字・_のみ、63文字以内で入力してください',
            ]"
            :error-messages="fieldError(error, 'name')"
            hint="例: ec_main、analytics"
            persistent-hint
            class="mb-2"
          />
          <v-textarea
            v-model="description"
            label="説明（任意）"
            rows="3"
            :disabled="!online || pending"
            :rules="[maxLength(LIMITS.databaseDescriptionMaxLength)]"
            :error-messages="fieldError(error, 'description')"
          />
          <template v-if="!database">
            <h3 class="text-subtitle-2">初期内容</h3>
            <v-radio-group v-model="initial" :disabled="!online || pending"
              ><v-radio label="空のデータベース" value="empty" /><v-radio
                label="既存の確定バージョンから複製"
                value="clone"
                :disabled="!cloneItems.length"
            /></v-radio-group>
            <template v-if="initial === 'clone'">
              <v-select
                v-model="sourceDatabaseId"
                label="複製元のデータベース"
                :items="cloneItems"
                :disabled="!online || pending"
                @update:model-value="sourceVersionId = ''"
              />
              <OperationError :error="source.error.value" />
              <v-select
                v-model="sourceVersionId"
                label="複製元の確定バージョン"
                :items="
                  finalVersions.map((version) => ({
                    value: version.id,
                    title: `v${version.number}`,
                  }))
                "
                :loading="!!sourceDatabaseId && source.isPending.value"
                :disabled="!online || pending || !sourceDatabaseId"
                :error-messages="fieldError(error, 'sourceVersionId')"
              />
              <p class="text-caption text-medium-emphasis">
                設計は独立したv1として複製します。共通カラムのセットは空で開始します。
              </p>
            </template>
            <p v-else class="text-caption text-medium-emphasis">
              v1（編集中）を作成します。PostgreSQLはpublicスキーマ、SQLiteはスキーマなしで開始します。
            </p>
          </template> </v-card-text
        ><v-card-actions
          ><v-spacer /><v-btn variant="outlined" :disabled="pending" @click="open = false"
            >キャンセル</v-btn
          ><v-btn
            type="submit"
            color="primary"
            :loading="pending"
            :disabled="
              !online ||
              !valid ||
              (initial === 'clone' &&
                !finalVersions.some((version) => version.id === sourceVersionId))
            "
            >{{ database ? '変更を保存' : '作成する' }}</v-btn
          ></v-card-actions
        ></v-form
      >
    </v-card>
  </v-dialog>
</template>
