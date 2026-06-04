<script setup lang="ts">
defineProps<{
  title: string
  description: string
  ctaLabel?: string
  ctaTo?: string
}>()
</script>

<template>
  <div class="surface-card px-5 py-6 text-center">
    <h2 class="text-lg font-semibold text-espresso-900">
      {{ title }}
    </h2>
    <p class="mt-2 text-sm leading-6 text-espresso-700">
      {{ description }}
    </p>

    <NuxtLink
      v-if="ctaLabel && ctaTo"
      :to="ctaTo"
      class="primary-button mt-5"
    >
      {{ ctaLabel }}
    </NuxtLink>
  </div>
</template>
