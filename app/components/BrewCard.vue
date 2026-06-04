<script setup lang="ts">
import { Pencil, Trash2 } from '@lucide/vue'
import { formatDateTime, formatRatio, formatWeight, noteToDisplayLabel, valueToDisplayLabel } from '~/utils/domain'
import type { Brew } from '~/utils/types'

defineProps<{
  brew: Brew
  beanName: string
}>()

defineEmits<{
  edit: [brewId: string]
  delete: [brewId: string]
}>()
</script>

<template>
  <article class="surface-card px-5 py-5">
    <div class="flex items-start justify-between gap-4">
      <div>
        <p class="text-lg font-semibold text-espresso-900">
          {{ beanName }}
        </p>
        <p class="mt-1 text-sm text-espresso-600">
          {{ formatDateTime(brew.brewedAt) }}
        </p>
      </div>

      <div class="flex items-center gap-1">
        <button
          type="button"
          class="ghost-button"
          aria-label="Edit brew"
          @click="$emit('edit', brew.id)"
        >
          <Pencil class="h-4 w-4" />
        </button>
        <button
          type="button"
          class="ghost-button text-coral-500 hover:bg-coral-100 hover:text-coral-500"
          aria-label="Delete brew"
          @click="$emit('delete', brew.id)"
        >
          <Trash2 class="h-4 w-4" />
        </button>
      </div>
    </div>

    <div class="mt-4 flex flex-wrap gap-2">
      <span class="badge bg-espresso-100 text-espresso-800">
        {{ valueToDisplayLabel(brew.method) }}
      </span>
      <span class="badge bg-sage-100 text-sage-500">
        {{ formatRatio(brew.ratio) }}
      </span>
    </div>

    <dl class="mt-5 grid grid-cols-3 gap-3 text-sm">
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Dose
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ formatWeight(brew.dose) }}
        </dd>
      </div>
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Yield
        </dt>
        <dd class="mt-1 font-medium text-espresso-900">
          {{ formatWeight(brew.yield) }}
        </dd>
      </div>
      <div class="rounded-2xl bg-cream-50 px-3 py-3">
        <dt class="text-espresso-500">
          Grinder
        </dt>
        <dd class="mt-1 truncate font-medium text-espresso-900">
          {{ brew.grinder || '—' }}
        </dd>
      </div>
    </dl>

    <div class="mt-4 space-y-3 text-sm text-espresso-700">
      <p v-if="brew.brewTime">
        <span class="font-medium text-espresso-900">Brew time:</span> {{ brew.brewTime }}
      </p>
      <p v-if="brew.pours">
        <span class="font-medium text-espresso-900">Pours:</span> {{ brew.pours }}
      </p>

      <div v-if="brew.tastingNotes.length" class="flex flex-wrap gap-2">
        <span
          v-for="note in brew.tastingNotes"
          :key="note"
          class="badge bg-cream-50 text-espresso-700"
        >
          {{ noteToDisplayLabel(note) }}
        </span>
      </div>
    </div>
  </article>
</template>
