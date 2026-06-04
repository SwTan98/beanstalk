<script setup lang="ts">
import { Archive, AlertTriangle, Bean as BeanIcon } from '@lucide/vue'
import { formatWeight, isBeanLowStock, valueToDisplayLabel } from '~/utils/domain'
import type { Bean } from '~/utils/types'

defineProps<{
  bean: Bean
}>()

defineEmits<{
  archive: [beanId: string]
}>()
</script>

<template>
  <article class="surface-card px-5 py-5">
    <div class="flex items-start justify-between gap-4">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <div class="rounded-2xl bg-espresso-100 p-2 text-espresso-800">
            <BeanIcon class="h-4 w-4" />
          </div>
          <div>
            <p class="truncate text-lg font-semibold text-espresso-900">
              {{ bean.name }}
            </p>
            <p class="text-sm text-espresso-600">
              {{ bean.roaster }}
            </p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap gap-2">
          <span
            v-if="bean.archivedAt"
            class="badge bg-stone-200 text-stone-700"
          >
            Archived
          </span>
          <span
            v-else-if="isBeanLowStock(bean)"
            class="badge bg-amber-100 text-amber-500"
          >
            <AlertTriangle class="h-3.5 w-3.5" />
            Low stock
          </span>
          <span class="badge bg-espresso-100 text-espresso-800">
            {{ valueToDisplayLabel(bean.roastProfile) }}
          </span>
        </div>
      </div>

      <button
        v-if="!bean.archivedAt"
        type="button"
        class="ghost-button shrink-0"
        @click="$emit('archive', bean.id)"
      >
        <Archive class="h-4 w-4" />
        Archive
      </button>
    </div>

    <dl class="mt-5 grid grid-cols-2 gap-3 text-sm">
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Origin
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ bean.origin }}
        </dd>
      </div>
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Process
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ bean.process }}
        </dd>
      </div>
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Remaining
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ formatWeight(bean.remaining) }}
        </dd>
      </div>
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Threshold
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ formatWeight(bean.threshold) }}
        </dd>
      </div>
    </dl>
  </article>
</template>
