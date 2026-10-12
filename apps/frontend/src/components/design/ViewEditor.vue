<script setup lang="ts">
import type { Target } from 'utils'
import { computed, ref, watch } from 'vue'
import { useDisplay } from 'vuetify'

import type { DesignObject, View } from '../../design/object.ts'
import { fullName } from '../../design/object.ts'
import OperationError from '../common/OperationError.vue'
import DesignField from './DesignField.vue'
import SqlEditor from './SqlEditor.vue'
const props = defineProps<{
  kind: 'view' | 'materialized_view'
  target: Target
  disabled: boolean
  objects: DesignObject[]
  analysis?: { columns: string[]; dependencies: string[] }
  pending: boolean
  error?: unknown
}>()
const value = defineModel<View>({ required: true })
const options = computed(() => value.value.options ?? (value.value.options = {}))
const emit = defineEmits<{ kind: [kind: 'view' | 'materialized_view']; validate: [] }>()
const { xs } = useDisplay()
const full = ref(false)
const checkedSql = ref('')
watch(
  () => props.analysis,
  (analysis) => {
    if (analysis) checkedSql.value = value.value.select
  },
)
const currentAnalysis = computed(() =>
  checkedSql.value === value.value.select ? props.analysis : undefined,
)
const changeKind = (kind: 'view' | 'materialized_view') => {
  value.value.options = kind === 'materialized_view' ? { withData: true } : {}
  emit('kind', kind)
}
</script>
<template>
  <div class="view-editor-layout">
    <div class="view-sql-column">
      <div v-if="target === 'postgresql18'" class="view-kind">
        <button
          :class="{ active: kind === 'view' }"
          :disabled="disabled"
          @click="changeKind('view')"
        >
          ビュー</button
        ><button
          :class="{ active: kind === 'materialized_view' }"
          :disabled="disabled"
          @click="changeKind('materialized_view')"
        >
          マテリアライズドビュー
        </button>
      </div>
      <section class="design-card view-sql">
        <div class="sql-caption">定義（SELECT）</div>
        <SqlEditor v-model="value.select" :target="target" :disabled="disabled" /><OperationError
          :error="error"
        />
        <div class="sql-actions">
          <span :class="currentAnalysis ? 'change-added' : 'screen-caption'">{{
            currentAnalysis
              ? '構文・参照チェック OK · ' + currentAnalysis.columns.length + 'カラム'
              : '検証を実行してください'
          }}</span
          ><v-spacer /><v-btn
            v-if="xs"
            variant="outlined"
            prepend-icon="mdi-arrow-expand"
            @click="full = true"
            >全画面で編集</v-btn
          ><v-btn
            v-else
            variant="outlined"
            prepend-icon="mdi-play-outline"
            :loading="pending"
            :disabled="disabled"
            @click="emit('validate')"
            >検証</v-btn
          >
        </div>
      </section>
    </div>
    <aside class="view-options design-fields">
      <h3>オプション</h3>
      <template v-if="target === 'postgresql18'"
        ><template v-if="kind === 'view'"
          ><v-switch
            v-model="options.securityInvoker"
            label="security_invoker"
            :disabled="disabled"
            hide-details
            inset /><v-switch
            v-model="options.securityBarrier"
            label="security_barrier"
            :disabled="disabled"
            hide-details
            inset /><DesignField
            v-model="options.checkOption"
            label="CHECK OPTION"
            :items="['LOCAL', 'CASCADED']"
            :disabled="disabled" /></template
        ><v-switch
          v-else
          v-model="options.withData"
          label="WITH DATA"
          :disabled="disabled"
          hide-details
          inset
      /></template>
      <p v-else class="screen-caption">SQLite 3</p>
      <hr />
      <h3>依存オブジェクト</h3>
      <div class="dependency-chips">
        <span
          v-for="key in currentAnalysis?.dependencies"
          :key="key"
          class="constraint-tag font-mono"
          >{{
            objects.find((o) => o.objectKey === key)
              ? fullName(
                  objects.find((o) => o.objectKey === key)!,
                  objects,
                )
              : key
          }}</span
        >
      </div>
      <p v-if="!currentAnalysis" class="screen-caption">検証後に表示されます</p>
      <hr />
      <h3>出力カラム（解析結果）</h3>
      <p v-for="col in currentAnalysis?.columns" :key="col" class="font-mono">{{ col }}</p>
      <DesignField
        v-model="value.comment"
        label="コメント"
        multiline
        :mono="false"
        :disabled="disabled"
      /><v-btn
        v-if="xs"
        variant="outlined"
        :loading="pending"
        :disabled="disabled"
        @click="emit('validate')"
        >検証</v-btn
      >
    </aside>
  </div>
  <v-dialog v-if="xs" v-model="full" fullscreen class="design-dialog"
    ><v-card class="fullscreen-sql"
      ><v-toolbar density="compact"
        ><v-btn
          icon="mdi-close"
          aria-label="SQL編集を閉じる"
          @click="full = false"
        /><v-toolbar-title>定義（SELECT）</v-toolbar-title
        ><v-btn :disabled="disabled" :loading="pending" @click="emit('validate')">検証</v-btn
        ><v-btn @click="full = false">完了</v-btn></v-toolbar
      ><SqlEditor v-model="value.select" :target="target" :disabled="disabled" /><OperationError
        :error="error" /></v-card
  ></v-dialog>
</template>
