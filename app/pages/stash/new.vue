<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import type { PhotoScanResult } from '~/composables/usePhotoScan'
import { DEFAULT_BEAN_THRESHOLD, ROAST_PROFILES } from '~/utils/domain'
import type { RoastProfile } from '~/utils/types'

const router = useRouter()
const { createBean } = useBeanstalk()

const draft = reactive({
  name: '',
  roaster: '',
  origin: '',
  region: '',
  varietal: '',
  process: '',
  roastProfile: 'medium' as RoastProfile,
  startWeight: 250,
  threshold: DEFAULT_BEAN_THRESHOLD
})

// The scan only fills roastProfile/startWeight when the user hasn't touched them, since
// both start with a sensible default value (unlike the empty text fields).
const fieldTouched = reactive({
  roastProfile: false,
  startWeight: false
})

const isScanBusy = ref(false)
const errorMessage = ref('')
const isSubmitting = ref(false)

function onPhotoScanned({ parsedFields }: PhotoScanResult) {
  if (!draft.name.trim() && parsedFields.name) draft.name = parsedFields.name
  if (!draft.roaster.trim() && parsedFields.roaster) draft.roaster = parsedFields.roaster
  if (!draft.origin.trim() && parsedFields.origin) draft.origin = parsedFields.origin
  if (!draft.region.trim() && parsedFields.region) draft.region = parsedFields.region
  if (!draft.varietal.trim() && parsedFields.varietal) draft.varietal = parsedFields.varietal
  if (!draft.process.trim() && parsedFields.process) draft.process = parsedFields.process
  if (!fieldTouched.roastProfile && parsedFields.roastProfile) draft.roastProfile = parsedFields.roastProfile
  if (!fieldTouched.startWeight && parsedFields.startWeight) draft.startWeight = parsedFields.startWeight
}

async function submitForm() {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await createBean({ ...draft })
    await router.push('/stash')
  }
  catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to save this bean right now.'
  }
  finally {
    isSubmitting.value = false
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-3">
      <NuxtLink to="/stash" class="ghost-button">
        <ArrowLeft class="h-4 w-4" />
        Back
      </NuxtLink>
    </div>

    <AppHeader
      title="New bean"
      description="Add a coffee to your stash with its starting weight and low-stock threshold."
    />

    <BeanPhotoScanner @scanned="onPhotoScanned" @busy="isScanBusy = $event" />

    <form class="space-y-5" @submit.prevent="submitForm">
      <div class="surface-card space-y-4 px-5 py-5">
        <div>
          <label class="field-label" for="name">Bean name</label>
          <input id="name" v-model="draft.name" type="text" class="field-input" placeholder="Ethiopia Worka Chelbesa">
        </div>

        <div>
          <label class="field-label" for="roaster">Roaster</label>
          <input id="roaster" v-model="draft.roaster" type="text" class="field-input" placeholder="e.g. Prodigal">
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="origin">Origin</label>
            <input id="origin" v-model="draft.origin" type="text" class="field-input" placeholder="Ethiopia">
          </div>

          <div>
            <label class="field-label" for="region">Region</label>
            <input id="region" v-model="draft.region" type="text" class="field-input" placeholder="Guji">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="varietal">Varietal</label>
            <input id="varietal" v-model="draft.varietal" type="text" class="field-input" placeholder="Heirloom">
          </div>

          <div>
            <label class="field-label" for="process">Process</label>
            <input id="process" v-model="draft.process" type="text" class="field-input" placeholder="Washed">
          </div>
        </div>

        <div>
          <label class="field-label" for="roastProfile">Roast profile</label>
          <select id="roastProfile" v-model="draft.roastProfile" class="field-input" @change="fieldTouched.roastProfile = true">
            <option
              v-for="profile in ROAST_PROFILES"
              :key="profile.value"
              :value="profile.value"
            >
              {{ profile.label }}
            </option>
          </select>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="field-label" for="startWeight">Starting weight (g)</label>
            <input id="startWeight" v-model.number="draft.startWeight" min="0.1" step="0.1" type="number" class="field-input" @input="fieldTouched.startWeight = true">
          </div>

          <div>
            <label class="field-label" for="threshold">Low-stock threshold (g)</label>
            <input id="threshold" v-model.number="draft.threshold" min="0" step="1" type="number" class="field-input">
          </div>
        </div>

        <p class="field-help">
          Remaining weight starts at the full bag amount and is adjusted automatically as you log brews.
        </p>
      </div>

      <p v-if="errorMessage" class="rounded-2xl bg-coral-100 px-4 py-3 text-sm text-coral-600">
        {{ errorMessage }}
      </p>

      <button type="submit" class="primary-button w-full" :disabled="isSubmitting || isScanBusy">
        Save bean
      </button>
    </form>
  </div>
</template>
