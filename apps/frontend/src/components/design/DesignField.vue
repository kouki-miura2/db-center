<script setup lang="ts" generic="T extends string | number | null | undefined">
import FormField from '../common/FormField.vue'
const props = withDefaults(
  defineProps<{
    label: string
    items?: readonly (string | { title: string; value: string })[]
    multiline?: boolean
    numeric?: boolean
    required?: boolean
    disabled?: boolean
    error?: string
    hint?: string
    mono?: boolean
  }>(),
  { mono: true },
)
const model = defineModel<T>()
const update = (value: string) => {
  model.value = numericValue(value) as T
}
const numericValue = (value: string) =>
  props.numeric ? (value === '' ? null : Number(value)) : value || (props.required ? '' : null)
</script>
<template>
  <FormField v-slot="{ id }" :label="label" :required="required" :hint="hint">
    <v-select
      v-if="items"
      :id="id"
      v-model="model"
      :clearable="!required"
      :items="items"
      :disabled="disabled"
      :error-messages="error"
      :class="{ 'font-mono': mono }"
      hide-details="auto"
      density="compact"
    />
    <v-textarea
      v-else-if="multiline"
      :id="id"
      v-model="model"
      :disabled="disabled"
      :error-messages="error"
      :class="{ 'font-mono': mono }"
      rows="3"
      auto-grow
      hide-details="auto"
      density="compact"
    />
    <v-text-field
      v-else
      :id="id"
      :model-value="model"
      :type="numeric ? 'number' : 'text'"
      :disabled="disabled"
      :error-messages="error"
      :class="{ 'font-mono': mono }"
      hide-details="auto"
      density="compact"
      @update:model-value="update"
    />
  </FormField>
</template>
