<script setup lang="ts">
const { ensureHydrated } = useBeanstalk()

onMounted(() => {
  void ensureHydrated()
})
</script>

<template>
  <NuxtRouteAnnouncer />
  <NuxtLoadingIndicator color="#8e5f3f" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>
