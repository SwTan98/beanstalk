<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import type { BrewDraft } from '~/utils/types'

const route = useRoute()
const router = useRouter()
const { beans, findStoredBrew, getBeanById, isLoading, updateBrew } = useBeanstalk()

const brewId = computed(() => String(route.params.id))
const draft = ref<BrewDraft | null>(null)
const errorMessage = ref('')
const isSubmitting = ref(false)
const loadError = ref('')

const availableBeans = computed(() =>
  beans.value.filter((bean) => {
    if (!draft.value) {
      return bean.archivedAt === null && bean.remaining > 0
    }

    return (bean.archivedAt === null && bean.remaining > 0) || bean.id === draft.value.beanId
  })
)

onMounted(async () => {
  const brew = await findStoredBrew(brewId.value)

  if (!brew) {
    loadError.value = 'This brew could not be found.'
    return
  }

  const linkedBean = getBeanById(brew.beanId)

  if (!linkedBean) {
    loadError.value = 'The linked bean for this brew is missing.'
    return
  }

  draft.value = {
    beanId: brew.beanId,
    brewedAt: brew.brewedAt,
    method: brew.method,
    grinder: brew.grinder,
    dose: brew.dose,
    yield: brew.yield,
    brewTime: brew.brewTime,
    pours: brew.pours,
    tastingNotes: [...brew.tastingNotes]
  }
})

async function submitForm(value: BrewDraft) {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await updateBrew(brewId.value, value)
    await router.push('/journal')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to update this brew right now.'
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
      title="Edit brew"
      description="Update the recipe and BeanStalk will restore the old dose before applying the new one."
    />

    <div v-if="isLoading || !draft" class="surface-card px-5 py-6 text-sm text-espresso-700">
      {{ loadError || 'Loading brew details…' }}
    </div>

    <template v-else>
      <p v-if="errorMessage" class="rounded-2xl bg-coral-100 px-4 py-3 text-sm text-coral-500">
        {{ errorMessage }}
      </p>

      <BrewForm
        :beans="availableBeans"
        :initial-draft="draft"
        :is-submitting="isSubmitting"
        submit-label="Update brew"
        @submit="submitForm"
      />
    </template>
  </div>
</template>
