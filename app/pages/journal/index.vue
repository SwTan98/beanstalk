<script setup lang="ts">
const router = useRouter()
const { brewsWithBean, isLoading, selectableBeans, deleteBrew } = useBeanstalk()

async function handleDelete(brewId: string) {
  if (!window.confirm('Delete this brew? The dose will be restored to the linked bean.')) {
    return
  }

  await deleteBrew(brewId)
}
</script>

<template>
  <div class="space-y-6">
    <AppHeader
      title="Journal"
      description="Log brews, keep stash weights accurate, and revisit recent recipes."
      action-label="Log brew"
      action-to="/journal/new"
    />

    <div v-if="isLoading" class="surface-card px-5 py-6 text-sm text-espresso-700">
      Loading your brew journal…
    </div>

    <template v-else>
      <EmptyState
        v-if="brewsWithBean.length === 0 && selectableBeans.length === 0"
        title="No brews yet"
        description="Add a bean to your stash first, then your journal can track brews and remaining weight."
        cta-label="Add bean"
        cta-to="/stash/new"
      />

      <EmptyState
        v-else-if="brewsWithBean.length === 0"
        title="Ready for your first brew"
        description="Choose an active bean and log a brew to start building your local journal."
        cta-label="Log brew"
        cta-to="/journal/new"
      />

      <div
        v-if="selectableBeans.length === 0"
        class="surface-card px-5 py-5 text-sm text-espresso-700"
      >
        All current beans are either archived or out of stock, so new brews are blocked until you add a fresh bag.
      </div>

      <section class="space-y-3">
        <BrewCard
          v-for="entry in brewsWithBean"
          :key="entry.brew.id"
          :brew="entry.brew"
          :bean-name="entry.bean?.name ?? 'Archived bean'"
          @edit="router.push(`/journal/${entry.brew.id}/edit`)"
          @delete="handleDelete"
        />
      </section>
    </template>
  </div>
</template>
