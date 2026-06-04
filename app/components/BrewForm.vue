<script setup lang="ts">
import { Plus, X } from '@lucide/vue'
import { BREW_METHODS, fromDateTimeLocalInput, noteToDisplayLabel, toDateTimeLocalInput } from '~/utils/domain'
import type { Bean, BrewDraft, BrewMethod } from '~/utils/types'

const props = withDefaults(defineProps<{
  beans: Bean[]
  initialDraft?: BrewDraft
  submitLabel?: string
  isSubmitting?: boolean
}>(), {
  initialDraft: () => ({
    beanId: '',
    brewedAt: new Date().toISOString(),
    method: 'v60' as BrewMethod,
    grinder: '',
    dose: 15,
    yield: 250,
    brewTime: '',
    pours: '',
    tastingNotes: []
  }),
  submitLabel: 'Save brew',
  isSubmitting: false
})

const emit = defineEmits<{
  submit: [value: BrewDraft]
}>()

const draft = reactive({
  beanId: props.initialDraft.beanId,
  brewedAt: toDateTimeLocalInput(props.initialDraft.brewedAt),
  method: props.initialDraft.method,
  grinder: props.initialDraft.grinder,
  dose: props.initialDraft.dose,
  yield: props.initialDraft.yield,
  brewTime: props.initialDraft.brewTime,
  pours: props.initialDraft.pours,
  tastingNotes: [...props.initialDraft.tastingNotes]
})

const noteInput = ref('')

watch(
  () => props.initialDraft,
  (value) => {
    draft.beanId = value.beanId
    draft.brewedAt = toDateTimeLocalInput(value.brewedAt)
    draft.method = value.method
    draft.grinder = value.grinder
    draft.dose = value.dose
    draft.yield = value.yield
    draft.brewTime = value.brewTime
    draft.pours = value.pours
    draft.tastingNotes = [...value.tastingNotes]
  },
  { deep: true }
)

const selectedBean = computed(() => props.beans.find((bean) => bean.id === draft.beanId) ?? null)
const ratioPreview = computed(() => {
  if (draft.dose <= 0 || draft.yield <= 0) {
    return '—'
  }

  return `1:${(draft.yield / draft.dose).toFixed(1)}`
})

function addNote() {
  const normalized = noteInput.value.trim().toLowerCase()

  if (!normalized || draft.tastingNotes.includes(normalized)) {
    noteInput.value = ''
    return
  }

  draft.tastingNotes = [...draft.tastingNotes, normalized]
  noteInput.value = ''
}

function removeNote(note: string) {
  draft.tastingNotes = draft.tastingNotes.filter((entry) => entry !== note)
}

function submitForm() {
  emit('submit', {
    beanId: draft.beanId,
    brewedAt: fromDateTimeLocalInput(draft.brewedAt),
    method: draft.method,
    grinder: draft.grinder,
    dose: Number(draft.dose),
    yield: Number(draft.yield),
    brewTime: draft.brewTime,
    pours: draft.pours,
    tastingNotes: draft.tastingNotes
  })
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="submitForm">
    <div class="surface-card space-y-4 px-5 py-5">
      <div>
        <label class="field-label" for="beanId">Bean</label>
        <select id="beanId" v-model="draft.beanId" class="field-input">
          <option value="">
            Select a bean
          </option>
          <option
            v-for="bean in beans"
            :key="bean.id"
            :value="bean.id"
          >
            {{ bean.name }} · {{ bean.remaining }}g left
          </option>
        </select>
        <p class="field-help">
          Only active beans with remaining stock are available here.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="field-label" for="brewedAt">Brewed at</label>
          <input id="brewedAt" v-model="draft.brewedAt" type="datetime-local" class="field-input">
        </div>

        <div>
          <label class="field-label" for="method">Method</label>
          <select id="method" v-model="draft.method" class="field-input">
            <option
              v-for="method in BREW_METHODS"
              :key="method.value"
              :value="method.value"
            >
              {{ method.label }}
            </option>
          </select>
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="field-label" for="dose">Dose (g)</label>
          <input id="dose" v-model.number="draft.dose" min="0.1" step="0.1" type="number" class="field-input">
        </div>

        <div>
          <label class="field-label" for="yield">Yield (g)</label>
          <input id="yield" v-model.number="draft.yield" min="0.1" step="0.1" type="number" class="field-input">
        </div>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="field-label" for="grinder">Grinder</label>
          <input id="grinder" v-model="draft.grinder" type="text" class="field-input" placeholder="e.g. Sculptor 078">
        </div>

        <div>
          <label class="field-label" for="brewTime">Brew time</label>
          <input id="brewTime" v-model="draft.brewTime" type="text" class="field-input" placeholder="e.g. 2:45">
        </div>
      </div>

      <div>
        <label class="field-label" for="pours">Pours / recipe notes</label>
        <textarea
          id="pours"
          v-model="draft.pours"
          class="field-input min-h-24"
          placeholder="Bloom 45g for 30s, then 3 pours to 250g"
        />
      </div>
    </div>

    <div class="surface-card px-5 py-5">
      <div class="flex items-start justify-between gap-4">
        <div>
          <p class="section-title">
            Tasting notes
          </p>
          <p class="mt-2 text-sm text-espresso-700">
            Add notes one by one. They will be stored in a normalized format for insights.
          </p>
        </div>

        <div class="rounded-2xl bg-espresso-100 px-3 py-2 text-right">
          <p class="text-xs uppercase tracking-[0.18em] text-espresso-500">
            Ratio
          </p>
          <p class="text-base font-semibold text-espresso-900">
            {{ ratioPreview }}
          </p>
        </div>
      </div>

      <div class="mt-4 flex gap-3">
        <input
          v-model="noteInput"
          type="text"
          class="field-input"
          placeholder="e.g. citrus"
          @keydown.enter.prevent="addNote"
        >
        <button type="button" class="secondary-button shrink-0" @click="addNote">
          <Plus class="h-4 w-4" />
          Add
        </button>
      </div>

      <div v-if="draft.tastingNotes.length" class="mt-4 flex flex-wrap gap-2">
        <button
          v-for="note in draft.tastingNotes"
          :key="note"
          type="button"
          class="badge bg-cream-50 text-espresso-800"
          @click="removeNote(note)"
        >
          {{ noteToDisplayLabel(note) }}
          <X class="h-3.5 w-3.5" />
        </button>
      </div>

      <div class="mt-5 rounded-2xl bg-cream-50 px-4 py-4 text-sm text-espresso-700">
        <p>
          Saving this brew deducts the dose from your stash.
          <span v-if="selectedBean" class="font-medium text-espresso-900">
            {{ selectedBean.remaining }}g is currently available for {{ selectedBean.name }}.
          </span>
        </p>
      </div>
    </div>

    <button
      type="submit"
      class="primary-button w-full"
      :disabled="isSubmitting || beans.length === 0"
    >
      {{ submitLabel }}
    </button>
  </form>
</template>
