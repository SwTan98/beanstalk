<script setup lang="ts">
import { Coffee, Lightbulb, Package2 } from "@lucide/vue";

const route = useRoute();

const items = [
  {
    label: "Stash",
    to: "/stash",
    icon: Package2,
  },
  {
    label: "Journal",
    to: "/journal",
    icon: Coffee,
  },
  {
    label: "Insights",
    to: "/insights",
    icon: Lightbulb,
  },
];
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-20 border-t border-white/70 bg-white/95 px-4 pb-5 pt-3 shadow-[0_-8px_30px_rgba(45,29,23,0.08)] backdrop-blur rounded-t-2xl"
  >
    <div class="mx-auto flex max-w-md items-center justify-between gap-2">
      <NuxtLink
        v-for="item in items"
        :key="item.to"
        :to="item.to"
        class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-2xl px-3 py-2 text-xs font-medium transition"
        :class="
          route.path.startsWith(item.to)
            ? 'bg-espresso-100 text-espresso-900'
            : 'text-espresso-500 hover:bg-cream-50 hover:text-espresso-800'
        "
      >
        <component :is="item.icon" class="h-5 w-5" />
        <span>{{ item.label }}</span>
      </NuxtLink>
    </div>
  </nav>
</template>
