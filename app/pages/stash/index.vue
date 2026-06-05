<script setup lang="ts">
const { activeBeans, archivedBeans, isLoading, lowStockBeans, archiveBean } =
  useBeanstalk();

async function handleArchive(beanId: string) {
  if (
    !window.confirm(
      "Archive this bean? It will stay in history but no longer be available for new brews.",
    )
  ) {
    return;
  }

  await archiveBean(beanId);
}
</script>

<template>
  <div class="space-y-6">
    <AppHeader
      title="Stash"
      description="Track what is on hand, how much remains, and which coffees are close to running out."
      action-label="Add bean"
      action-to="/stash/new"
    />

    <div
      v-if="isLoading"
      class="surface-card px-5 py-6 text-sm text-espresso-700"
    >
      Loading your local stash…
    </div>

    <template v-else>
      <div v-if="lowStockBeans.length" class="surface-card px-5 py-5">
        <p class="section-title">Low-stock alert</p>
        <p class="mt-2 text-sm text-espresso-700">
          {{ lowStockBeans.length }} bean{{
            lowStockBeans.length === 1 ? "" : "s"
          }}
          reached the low-stock threshold.
        </p>
      </div>

      <EmptyState
        v-if="activeBeans.length === 0 && archivedBeans.length === 0"
        title="Your stash starts here"
        description="Add your first bag to keep local inventory, low-stock alerts, and brew deductions in sync."
        cta-label="Add bean"
        cta-to="/stash/new"
      />

      <section v-if="activeBeans.length" class="space-y-3">
        <div class="flex items-center justify-between">
          <h2 class="section-title">Active beans</h2>
          <p class="text-sm text-espresso-500">
            {{ activeBeans.length }} total
          </p>
        </div>

        <BeanCard
          v-for="bean in activeBeans"
          :key="bean.id"
          :bean="bean"
          @archive="handleArchive"
        />
      </section>

      <section v-if="archivedBeans.length" class="space-y-3">
        <div class="flex flex-col xs:flex-row xs:items-center justify-between">
          <h2 class="section-title">Archived beans</h2>
          <p class="text-sm text-espresso-500">Still linked to past brews</p>
        </div>

        <BeanCard v-for="bean in archivedBeans" :key="bean.id" :bean="bean" />
      </section>
    </template>
  </div>
</template>
