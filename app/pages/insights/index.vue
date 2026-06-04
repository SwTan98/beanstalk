<script setup lang="ts">
import { formatWeight, noteToDisplayLabel } from '~/utils/domain'

const { activeBeans, brews, dialingInTip, latestBrew, lowStockBeans, topTastingNotes } = useBeanstalk()

const activeWeight = computed(() =>
  activeBeans.value.reduce((total, bean) => total + bean.remaining, 0)
)
</script>

<template>
  <div class="space-y-6">
    <AppHeader
      title="Insights"
      description="See what is running low, which notes show up most often, and what your latest cup suggests."
    />

    <section class="grid grid-cols-2 gap-3">
      <MetricCard
        label="Active beans"
        :value="String(activeBeans.length)"
        helper="Bags currently available in your stash."
      />
      <MetricCard
        label="Remaining weight"
        :value="formatWeight(activeWeight)"
        helper="Total coffee still available across active bags."
        tone="success"
      />
      <MetricCard
        label="Low-stock bags"
        :value="String(lowStockBeans.length)"
        helper="Beans at or below their threshold right now."
        tone="warning"
      />
      <MetricCard
        label="Brews logged"
        :value="String(brews.length)"
        helper="All local brew entries stored on this device."
      />
    </section>

    <section class="surface-card px-5 py-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <h2 class="section-title">
            Low-stock summary
          </h2>
          <p class="mt-2 text-sm text-espresso-700">
            Keep an eye on bags that are approaching their threshold.
          </p>
        </div>
      </div>

      <div v-if="lowStockBeans.length" class="mt-4 space-y-3">
        <div
          v-for="bean in lowStockBeans"
          :key="bean.id"
          class="rounded-2xl bg-amber-100/60 px-4 py-4"
        >
          <p class="font-semibold text-espresso-900">
            {{ bean.name }}
          </p>
          <p class="mt-1 text-sm text-espresso-700">
            {{ formatWeight(bean.remaining) }} left · threshold {{ formatWeight(bean.threshold) }}
          </p>
        </div>
      </div>
      <p v-else class="mt-4 rounded-2xl bg-sage-100/50 px-4 py-4 text-sm text-espresso-700">
        Nothing urgent right now. Your active stash is above every low-stock threshold.
      </p>
    </section>

    <section class="surface-card px-5 py-5">
      <h2 class="section-title">
        Top tasting notes
      </h2>
      <p class="mt-2 text-sm text-espresso-700">
        Notes are normalized in storage so similar tags stay grouped.
      </p>

      <div v-if="topTastingNotes.length" class="mt-4 space-y-3">
        <div
          v-for="entry in topTastingNotes"
          :key="entry.note"
          class="flex items-center justify-between rounded-2xl bg-cream-50 px-4 py-4"
        >
          <p class="font-medium text-espresso-900">
            {{ noteToDisplayLabel(entry.note) }}
          </p>
          <span class="badge bg-espresso-100 text-espresso-800">
            {{ entry.count }}x
          </span>
        </div>
      </div>
      <p v-else class="mt-4 rounded-2xl bg-cream-50 px-4 py-4 text-sm text-espresso-700">
        Tasting notes will start to collect here once you log a few brews.
      </p>
    </section>

    <section class="surface-card px-5 py-5">
      <h2 class="section-title">
        Dialing-in helper
      </h2>
      <p class="mt-2 text-sm text-espresso-700">
        A lightweight rule-based nudge based on the latest tasting notes.
      </p>

      <div class="mt-4 rounded-3xl bg-espresso-800 px-5 py-5 text-white">
        <p class="text-sm uppercase tracking-[0.18em] text-espresso-200">
          {{ dialingInTip.title }}
        </p>
        <p class="mt-3 text-sm leading-6 text-white/90">
          {{ dialingInTip.guidance }}
        </p>
        <p v-if="latestBrew && dialingInTip.note" class="mt-4 text-xs text-espresso-100/80">
          Triggered by “{{ noteToDisplayLabel(dialingInTip.note) }}” from your latest brew.
        </p>
      </div>
    </section>
  </div>
</template>
