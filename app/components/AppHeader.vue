<script setup lang="ts">
defineProps<{
  title: string
  description: string
  actionLabel?: string
  actionTo?: string
}>()
</script>

<template>
  <header class="mb-6 flex items-start justify-between gap-4">
    <div class="min-w-0">
      <p class="mb-2 text-sm font-medium uppercase tracking-[0.24em] text-espresso-500">
        BeanStalk
      </p>
      <h1 class="text-3xl font-semibold tracking-tight text-espresso-900">
        {{ title }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-espresso-700">
        {{ description }}
      </p>
    </div>

    <NuxtLink
      v-if="actionLabel && actionTo"
      :to="actionTo"
      class="primary-button shrink-0"
    >
      {{ actionLabel }}
    </NuxtLink>
  </header>
</template>
