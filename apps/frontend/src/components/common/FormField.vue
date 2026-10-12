<script setup lang="ts">
import { useId } from 'vue'

const props = defineProps<{ label: string; required?: boolean; hint?: string; id?: string }>()
const generatedId = useId()
defineSlots<{ default: (props: { id: string }) => unknown; label?: () => unknown }>()
</script>
<template>
  <div class="form-field">
    <label :for="props.id ?? generatedId" class="field-label"
      >{{ label }}<span v-if="required" class="text-error"> *</span><slot name="label"
    /></label>
    <slot :id="props.id ?? generatedId" />
    <p v-if="hint" class="field-hint">{{ hint }}</p>
  </div>
</template>
