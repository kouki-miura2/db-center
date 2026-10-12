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
import { useAuthStore } from '../../stores/auth.ts'
import { useNotificationStore } from '../../stores/notification.ts'
import FormField from '../common/FormField.vue'
import OperationError from '../common/OperationError.vue'
import VersionChip from './VersionChip.vue'

const props = defineProps<{
  productId: string
  databases: ProductData['databases']
  database?: ProductData['databases'][number]
}>()
const open = defineModel<boolean>({ required: true })
const mutation = useDatabaseMutations(props.productId)
const router = useRouter()
const online = useOnline()
const { xs, sm } = useDisplay()
const auth = useAuthStore()
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
  <v-dialog
    v-model="open"
    :fullscreen="xs"
    :max-width="xs ? undefined : sm ? 616 : 596"
    :persistent="pending"
    :class="['design-dialog', 'database-form-dialog', { 'fullscreen-form-dialog': xs }]"
  >
    <v-card>
      <div class="dialog-heading d-flex align-center ga-2">
        <v-btn
          v-if="xs"
          icon="mdi-arrow-left"
          variant="text"
          size="small"
          aria-label="キャンセル"
          :disabled="pending"
          @click="open = false"
        />
        <h2>{{ database ? 'データベースの名前・説明を変更' : 'データベースを作成' }}</h2>
        <v-spacer v-if="xs" /><v-avatar v-if="xs" size="30" class="member-avatar avatar-owner">{{
          [...(auth.user?.name ?? '')][0]
        }}</v-avatar>
      </div>
      <v-form v-model="valid" @submit.prevent="save">
        <div class="dialog-body">
          <OperationError :error="error" @reload="reload" />
          <FormField
            v-slot="{ id }"
            label="データベース名"
            required
            hint="英小文字で始まり、英小文字・数字・_のみ、63文字以内。プロダクト内で一意"
          >
            <v-text-field
              :id="id"
              v-model="name"
              class="font-mono"
              autofocus
              :disabled="!online || pending"
              :rules="[
                required,
                (value: string) =>
                  isDatabaseName(value.trim()) ||
                  '英小文字で始まり、英小文字・数字・_のみ、63文字以内で入力してください',
              ]"
              :error-messages="fieldError(error, 'name')"
              hide-details="auto"
            />
          </FormField>
          <FormField v-slot="{ id }" label="説明"
            ><v-text-field
              :id="id"
              v-model="description"
              :disabled="!online || pending"
              :rules="[maxLength(LIMITS.databaseDescriptionMaxLength)]"
              :error-messages="fieldError(error, 'description')"
              hide-details="auto"
          /></FormField>
          <template v-if="!database">
            <div>
              <p class="field-label">初期内容</p>
              <v-radio-group
                v-model="initial"
                :disabled="!online || pending"
                class="initial-options"
                hide-details
              >
                <v-radio value="empty" :class="{ chosen: initial === 'empty' }"
                  ><template #label
                    ><div>
                      <strong>空のデータベース</strong>
                      <p class="screen-caption">
                        {{
                          product.data.value?.data.product.target === 'sqlite3'
                            ? 'スキーマなしで作成します'
                            : 'スキーマ public のみ作成します'
                        }}
                      </p>
                    </div></template
                  ></v-radio
                >
                <v-radio
                  value="clone"
                  :class="{ chosen: initial === 'clone' }"
                  :disabled="!cloneItems.length"
                  ><template #label
                    ><div>
                      <strong>既存データベースから複製</strong>
                      <p class="screen-caption">
                        {{
                          cloneItems.length
                            ? '確定バージョンを新しいDBの v1 として複製します'
                            : '複製できる確定バージョンはありません'
                        }}
                      </p>
                    </div></template
                  ></v-radio
                >
              </v-radio-group>
            </div>
            <template v-if="initial === 'clone'">
              <FormField v-slot="{ id }" label="複製元のデータベース"
                ><v-select
                  :id="id"
                  v-model="sourceDatabaseId"
                  :items="cloneItems"
                  :disabled="!online || pending"
                  hide-details="auto"
                  @update:model-value="sourceVersionId = ''"
              /></FormField>
              <OperationError :error="source.error.value" />
              <FormField v-slot="{ id }" label="複製元の確定バージョン"
                ><v-select
                  :id="id"
                  v-model="sourceVersionId"
                  :items="
                    finalVersions.map((version) => ({
                      value: version.id,
                      title: 'v' + version.number,
                    }))
                  "
                  :loading="!!sourceDatabaseId && source.isPending.value"
                  :disabled="!online || pending || !sourceDatabaseId"
                  :error-messages="fieldError(error, 'sourceVersionId')"
                  hide-details="auto"
              /></FormField>
              <p class="screen-caption">
                設計は独立したv1として複製します。共通カラムのセットは空で開始します。
              </p>
            </template>
            <div class="creation-info d-flex align-center ga-2">
              <v-icon size="16">mdi-information-outline</v-icon><span v-if="!xs">作成すると</span
              ><VersionChip :version="{ id: '', number: 1, status: 'editing' }" /><span>{{
                xs ? 'で作成されます' : 'の状態で設計画面が開きます'
              }}</span>
            </div>
          </template>
        </div>
        <div class="dialog-actions">
          <v-btn v-if="!xs" variant="text" :disabled="pending" @click="open = false"
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
            >{{ database ? '変更を保存' : '作成して設計を開始' }}</v-btn
          >
        </div>
      </v-form>
    </v-card>
  </v-dialog>
</template>
