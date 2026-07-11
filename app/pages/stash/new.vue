<script setup lang="ts">
import { ArrowLeft } from '@lucide/vue'
import { LABEL_FIELD_KEYS, splitTastingNotes, type LabelParseResult } from '~/utils/bean-label-parser'
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
  roastDate: null as string | null,
  startWeight: 250,
  threshold: DEFAULT_BEAN_THRESHOLD
})

// Comma-separated in the input; split at submit and normalized by createBean.
const tastingNotesText = ref('')

const isScanBusy = ref(false)
const errorMessage = ref('')
const isSubmitting = ref(false)

// Marks which inputs a scan filled, so the user knows what to verify.
const prefilledFields = ref(new Set<string>())

// A scan replaces the whole form: scannable fields reset to their defaults,
// then everything the parser found is applied. Threshold is never scanned.
function onPhotoScanned(parsedFields: LabelParseResult) {
  draft.name = parsedFields.name ?? ''
  draft.roaster = parsedFields.roaster ?? ''
  draft.origin = parsedFields.origin ?? ''
  draft.region = parsedFields.region ?? ''
  draft.varietal = parsedFields.varietal ?? ''
  draft.process = parsedFields.process ?? ''
  draft.roastProfile = parsedFields.roastProfile ?? 'medium'
  draft.roastDate = parsedFields.roastDate
  draft.startWeight = parsedFields.startWeight ?? 250
  tastingNotesText.value = parsedFields.tastingNotes.join(', ')

  prefilledFields.value = new Set(
    LABEL_FIELD_KEYS.filter((key) => {
      const value = parsedFields[key]
      return Array.isArray(value) ? value.length > 0 : value !== null
    })
  )
}

function clearPrefill(key: string) {
  // Vue's reactive() instruments Set mutation methods directly, so this
  // in-place delete is tracked without needing to clone and reassign.
  prefilledFields.value.delete(key)
}

function prefillClass(key: string) {
  return prefilledFields.value.has(key) ? 'ring-1 ring-espresso-300 bg-cream-50' : ''
}

const roastDateInput = computed({
  get: () => draft.roastDate ?? '',
  set: (value: string) => {
    draft.roastDate = value || null
  }
})

async function submitForm() {
  errorMessage.value = ''
  isSubmitting.value = true

  try {
    await createBean({ ...draft, tastingNotes: splitTastingNotes(tastingNotesText.value) })
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
          <input id="name" v-model="draft.name" type="text" class="field-input" :class="prefillClass('name')" placeholder="Ethiopia Worka Chelbesa" @input="clearPrefill('name')">
        </div>

        <div>
          <label class="field-label" for="roaster">Roaster</label>
          <input id="roaster" v-model="draft.roaster" type="text" class="field-input" :class="prefillClass('roaster')" placeholder="e.g. Prodigal" @input="clearPrefill('roaster')">
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col">
            <label class="field-label" for="origin">Origin</label>
            <input id="origin" v-model="draft.origin" type="text" class="field-input mt-auto" :class="prefillClass('origin')" placeholder="Ethiopia" @input="clearPrefill('origin')">
          </div>

          <div class="flex flex-col">
            <label class="field-label" for="region">Region</label>
            <input id="region" v-model="draft.region" type="text" class="field-input mt-auto" :class="prefillClass('region')" placeholder="Guji" @input="clearPrefill('region')">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col">
            <label class="field-label" for="varietal">Varietal</label>
            <input id="varietal" v-model="draft.varietal" type="text" class="field-input mt-auto" :class="prefillClass('varietal')" placeholder="Heirloom" @input="clearPrefill('varietal')">
          </div>

          <div class="flex flex-col">
            <label class="field-label" for="process">Process</label>
            <input id="process" v-model="draft.process" type="text" class="field-input mt-auto" :class="prefillClass('process')" placeholder="Washed" @input="clearPrefill('process')">
          </div>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col">
            <label class="field-label" for="roastProfile">Roast profile</label>
            <select id="roastProfile" v-model="draft.roastProfile" class="field-input mt-auto" :class="prefillClass('roastProfile')" @change="clearPrefill('roastProfile')">
              <option
                v-for="profile in ROAST_PROFILES"
                :key="profile.value"
                :value="profile.value"
              >
                {{ profile.label }}
              </option>
            </select>
          </div>

          <div class="flex flex-col">
            <label class="field-label" for="roastDate">Roast date</label>
            <input id="roastDate" v-model="roastDateInput" type="date" class="field-input mt-auto" :class="prefillClass('roastDate')" @input="clearPrefill('roastDate')">
          </div>
        </div>

        <div>
          <label class="field-label" for="tastingNotes">Tasting notes</label>
          <input id="tastingNotes" v-model="tastingNotesText" type="text" class="field-input" :class="prefillClass('tastingNotes')" placeholder="Blackberry, lemon zest, jasmine" @input="clearPrefill('tastingNotes')">
          <p class="field-help">
            Separate notes with commas.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <div class="flex flex-col">
            <label class="field-label" for="startWeight">Starting weight (g)</label>
            <input id="startWeight" v-model.number="draft.startWeight" min="0.1" step="0.1" type="number" class="field-input mt-auto" :class="prefillClass('startWeight')" @input="clearPrefill('startWeight')">
          </div>

          <div class="flex flex-col">
            <label class="field-label" for="threshold">Low-stock threshold (g)</label>
            <input id="threshold" v-model.number="draft.threshold" min="0" step="1" type="number" class="field-input mt-auto">
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
