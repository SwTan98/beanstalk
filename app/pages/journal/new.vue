<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'

const router = useRouter()
const { createBrew, selectableBeans } = useBeanstalk()

const errorMessage = ref('')
const isSubmitting = ref(false)

async function submitForm(value: Parameters<typeof createBrew>[0]) {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await createBrew(value)
    await router.push('/journal')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to save this brew right now.'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <NuxtLink to="/journal" class="ghost-button">
        <ArrowLeft class="h-4 w-4" />
        Back
      </NuxtLink>
    </div>

    <AppHeader
      title="New brew"
      description="Choose an active bean, preview the ratio, and save the brew into your local journal."
    />

    <EmptyState
      v-if="selectableBeans.length === 0"
      title="No beans ready for brewing"
      description="Archived beans and empty bags stay in history, but only active beans with stock can be selected."
      cta-label="Add bean"
      cta-to="/stash/new"
    />

    <template v-else>
      <p v-if="errorMessage" class="rounded-2xl bg-coral-100 px-4 py-3 text-sm text-coral-500">
        {{ errorMessage }}
      </p>

      <BrewForm
        :beans="selectableBeans"
        :is-submitting="isSubmitting"
        submit-label="Save brew"
        @submit="submitForm"
      />
    </template>
  </div>
</template>
