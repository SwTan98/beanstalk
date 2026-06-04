<script setup lang="ts">
defineProps<{
  label: string
  value: string
  helper: string
  tone?: 'default' | 'success' | 'warning'
}>()
</script>

<template>
  <div
    class="surface-card px-4 py-4"
    :class="{
      'border-sage-100 bg-sage-100/50': tone === 'success',
      'border-amber-100 bg-amber-100/50': tone === 'warning'
    }"
  >
    <p class="text-sm font-medium text-espresso-600">
      {{ label }}
    </p>
    <p class="mt-2 text-2xl font-semibold tracking-tight text-espresso-900">
      {{ value }}
    </p>
    <p class="mt-2 text-xs leading-5 text-espresso-700">
      {{ helper }}
    </p>
  </div>
</template>
