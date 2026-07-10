<script setup lang="ts">
import { Archive, AlertTriangle, Bean as BeanIcon } from "@lucide/vue";
import {
  formatDate,
  formatWeight,
  isBeanLowStock,
  noteToDisplayLabel,
  valueToDisplayLabel,
} from "~/utils/domain";
import type { Bean } from "~/utils/types";

defineProps<{
  bean: Bean;
}>();

defineEmits<{
  archive: [beanId: string];
}>();
</script>

<template>
  <article class="surface-card overflow-hidden px-5 py-5">
    <div
      class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between"
    >
      <div class="min-w-0 flex-1">
        <div class="flex items-start gap-3">
          <div
            class="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-espresso-100 text-espresso-800 shadow-inner shadow-white/60"
          >
            <BeanIcon class="h-4 w-4" />
          </div>
          <div class="min-w-0">
            <p
              class="truncate text-base leading-tight font-semibold text-espresso-900 sm:text-lg"
            >
              {{ bean.name }}
            </p>
            <p class="mt-1 truncate text-sm text-espresso-600">
              {{ bean.roaster }}
            </p>
          </div>
        </div>

        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-if="bean.archivedAt"
            class="badge bg-stone-200 text-stone-700"
          >
            Archived
          </span>
          <span
            v-else-if="isBeanLowStock(bean)"
            class="badge bg-amber-100 text-amber-600"
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            Low stock
          </span>
          <span class="badge bg-espresso-100 text-espresso-800">
            {{ valueToDisplayLabel(bean.roastProfile) }}
          </span>
        </div>

        <p
          v-if="bean.tastingNotes.length > 0"
          class="mt-3 truncate text-sm text-espresso-600"
        >
          {{ bean.tastingNotes.map(noteToDisplayLabel).join(" · ") }}
        </p>
      </div>

      <button
        v-if="!bean.archivedAt"
        type="button"
        class="ghost-button shrink-0 self-start border border-espresso-200/80 bg-cream-50/80 px-3.5 py-2.5 text-xs font-semibold hover:border-espresso-300 hover:bg-white"
        @click="$emit('archive', bean.id)"
      >
        <Archive class="h-4 w-4" />
        Archive
      </button>
    </div>

    <dl class="mt-5 grid grid-cols-1 xs:grid-cols-2 gap-3 text-sm">
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Origin
        </dt>
        <dd
          class="mt-1.5 break-words text-sm font-semibold leading-5 text-espresso-900"
        >
          {{ bean.origin }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Process
        </dt>
        <dd
          class="mt-1.5 break-words text-sm font-semibold leading-5 text-espresso-900"
        >
          {{ bean.process }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Region
        </dt>
        <dd
          class="mt-1.5 break-words text-sm font-semibold leading-5 text-espresso-900"
        >
          {{ bean.region || "—" }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Varietal
        </dt>
        <dd
          class="mt-1.5 break-words text-sm font-semibold leading-5 text-espresso-900"
        >
          {{ bean.varietal || "—" }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Roast date
        </dt>
        <dd
          class="mt-1.5 break-words text-sm font-semibold leading-5 text-espresso-900"
        >
          {{ bean.roastDate ? formatDate(bean.roastDate) : "—" }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-espresso-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Remaining
        </dt>
        <dd class="mt-1.5 text-base font-semibold leading-5 text-espresso-900">
          {{ formatWeight(bean.remaining) }}
        </dd>
      </div>
      <div
        class="min-w-0 rounded-2xl border border-cream-100 bg-cream-50 px-3.5 py-3"
      >
        <dt
          class="text-xs font-medium uppercase tracking-[0.08em] text-espresso-500"
        >
          Threshold
        </dt>
        <dd class="mt-1.5 text-base font-semibold leading-5 text-espresso-900">
          {{ formatWeight(bean.threshold) }}
        </dd>
      </div>
    </dl>
  </article>
</template>
