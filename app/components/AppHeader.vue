<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  actionLabel?: string;
  actionTo?: string;
}>();
</script>

<template>
  <header class="flex flex-col gap-4">
    <div class="flex items-center justify-between gap-2 h-10">
      <p
        class="text-sm font-medium uppercase tracking-[0.24em] text-espresso-500"
      >
        BeanStalk
      </p>
      <NuxtLink
        v-if="actionLabel && actionTo"
        :to="actionTo"
        class="primary-button shrink-0"
      >
        {{ actionLabel }}
      </NuxtLink>
    </div>
    <div class="">
      <h1 class="text-3xl font-semibold tracking-tight text-espresso-900">
        {{ title }}
      </h1>
      <p class="mt-2 text-sm leading-6 text-espresso-700">
        {{ description }}
      </p>
    </div>
  </header>
</template>
