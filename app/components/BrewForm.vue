<script setup lang="ts">
import { Plus, X } from "@lucide/vue";
import {
  BREW_METHODS,
  calculateRatio,
  fromDateTimeLocalInput,
  noteToDisplayLabel,
  roundToSingleDecimal,
  toDateTimeLocalInput,
} from "~/utils/domain";
import type { Bean, BrewDraft, BrewMethod, Grinder } from "~/utils/types";

const props = defineProps<{
  beans: Bean[];
  initialDraft?: BrewDraft;
  submitLabel?: string;
  isSubmitting?: boolean;
}>();

const emit = defineEmits<{
  submit: [value: BrewDraft];
}>();

const { grinders, addGrinder, removeGrinder, lastUsedGrinderName } =
  useBeanstalk();

const draft = reactive<{
  beanId: string;
  brewedAt: string;
  method: BrewMethod;
  grinder: string;
  dose: number | null;
  yield: number | null;
  pours: string;
  tastingNotes: string[];
}>({
  beanId: "",
  brewedAt: toDateTimeLocalInput(new Date().toISOString()),
  method: "v60",
  grinder: "",
  dose: null,
  yield: null,
  pours: "",
  tastingNotes: [],
});

const ratioInput = ref<number | null>(null);
const brewMinutes = ref<number | null>(null);
const brewSeconds = ref<number | null>(null);

const noteInput = ref("");
const noteInputRef = ref<HTMLInputElement | null>(null);

const isManagingGrinders = ref(false);
const newGrinderName = ref("");
const grinderError = ref("");
const grinderTouched = ref(false);

const fieldErrors = reactive<Record<string, string>>({});

function applyDraft(value: BrewDraft) {
  draft.beanId = value.beanId;
  draft.brewedAt = toDateTimeLocalInput(value.brewedAt);
  draft.method = value.method;
  draft.grinder = value.grinder;
  draft.dose = value.dose > 0 ? value.dose : null;
  draft.yield = value.yield > 0 ? value.yield : null;
  ratioInput.value =
    value.dose > 0 && value.yield > 0
      ? calculateRatio(value.dose, value.yield)
      : null;
  const totalSeconds = Math.max(0, Math.round(value.brewTime));
  brewMinutes.value = Math.floor(totalSeconds / 60);
  brewSeconds.value = totalSeconds % 60;
  draft.pours = value.pours;
  draft.tastingNotes = [...value.tastingNotes];
}

if (props.initialDraft) {
  applyDraft(props.initialDraft);
}

watch(
  () => props.initialDraft,
  (value) => {
    if (value) {
      applyDraft(value);
    }
  },
  { deep: true },
);

// New brews only: prefill the grinder with the one from the most recent brew
// once hydration delivers it, unless the user has already picked one.
if (!props.initialDraft) {
  watch(
    lastUsedGrinderName,
    (value) => {
      if (!grinderTouched.value && !draft.grinder && value) {
        draft.grinder = value;
      }
    },
    { immediate: true },
  );
}

const selectedBean = computed(
  () => props.beans.find((bean) => bean.id === draft.beanId) ?? null,
);

// A brew being edited may reference a grinder name that is no longer (or was
// never) in the managed list; surface it as an extra option so the select can
// render the stored value.
const legacyGrinderName = computed(() => {
  const name = draft.grinder.trim();

  if (!name || grinders.value.some((grinder: Grinder) => grinder.name === name)) {
    return null;
  }

  return name;
});

const ratioPreview = computed(() => {
  const dose = asNumber(draft.dose);
  const yieldAmount = asNumber(draft.yield);

  if (dose === null || dose <= 0 || yieldAmount === null || yieldAmount <= 0) {
    return "—";
  }

  return `1:${(yieldAmount / dose).toFixed(1)}`;
});

function asNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readNumber(event: Event): number | null {
  const raw = (event.target as HTMLInputElement).value.trim();

  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function clearError(key: string) {
  delete fieldErrors[key];
}

function errorClass(key: string) {
  return fieldErrors[key] ? "ring-1 ring-coral-400 bg-coral-100/40" : "";
}

function errorClassAny(...keys: string[]) {
  return keys.some((key) => fieldErrors[key])
    ? "ring-1 ring-coral-400 bg-coral-100/40"
    : "";
}

function onDoseInput(event: Event) {
  clearError("dose");
  draft.dose = readNumber(event);

  const dose = asNumber(draft.dose);
  const ratio = asNumber(ratioInput.value);
  const yieldAmount = asNumber(draft.yield);

  if (dose === null || dose <= 0) {
    return;
  }

  if (ratio !== null && ratio > 0) {
    draft.yield = roundToSingleDecimal(dose * ratio);
    clearError("yield");
  } else if (yieldAmount !== null && yieldAmount > 0) {
    ratioInput.value = calculateRatio(dose, yieldAmount);
  }
}

function onRatioInput(event: Event) {
  ratioInput.value = readNumber(event);

  const dose = asNumber(draft.dose);
  const ratio = asNumber(ratioInput.value);

  if (dose !== null && dose > 0 && ratio !== null && ratio > 0) {
    draft.yield = roundToSingleDecimal(dose * ratio);
    clearError("yield");
  }
}

function onYieldInput(event: Event) {
  clearError("yield");
  draft.yield = readNumber(event);

  const dose = asNumber(draft.dose);
  const yieldAmount = asNumber(draft.yield);

  if (dose !== null && dose > 0 && yieldAmount !== null && yieldAmount > 0) {
    ratioInput.value = calculateRatio(dose, yieldAmount);
  }
}

function onMinutesInput(event: Event) {
  clearError("brewMinutes");
  brewMinutes.value = readNumber(event);
}

function onSecondsInput(event: Event) {
  clearError("brewSeconds");
  brewSeconds.value = readNumber(event);
}

async function submitNewGrinder() {
  const name = newGrinderName.value.trim();

  if (!name) {
    return;
  }

  try {
    const grinder = await addGrinder(name);
    draft.grinder = grinder.name;
    grinderTouched.value = true;
    newGrinderName.value = "";
    grinderError.value = "";
  } catch (error) {
    grinderError.value =
      error instanceof Error ? error.message : "Unable to add this grinder.";
  }
}

async function removeGrinderEntry(grinder: Grinder) {
  try {
    await removeGrinder(grinder.id);
    grinderError.value = "";
  } catch (error) {
    grinderError.value =
      error instanceof Error ? error.message : "Unable to remove this grinder.";
  }
}

function addNote() {
  const normalized = noteInput.value.trim().toLowerCase();

  if (!normalized || draft.tastingNotes.includes(normalized)) {
    noteInput.value = "";
    noteInputRef.value?.focus();
    return;
  }

  draft.tastingNotes = [...draft.tastingNotes, normalized];
  noteInput.value = "";
  noteInputRef.value?.focus();
}

function removeNote(note: string) {
  draft.tastingNotes = draft.tastingNotes.filter((entry) => entry !== note);
}

function validate(): string | null {
  for (const key of Object.keys(fieldErrors)) {
    delete fieldErrors[key];
  }

  if (!draft.beanId) {
    fieldErrors.beanId = "Select a bean.";
  }

  const dose = asNumber(draft.dose);
  const yieldAmount = asNumber(draft.yield);
  const minutes = asNumber(brewMinutes.value);
  const seconds = asNumber(brewSeconds.value);

  if (dose === null || dose <= 0) {
    fieldErrors.dose = "Enter a dose greater than 0g.";
  }

  if (yieldAmount === null || yieldAmount <= 0) {
    fieldErrors.yield = "Enter a yield greater than 0g.";
  }

  if (minutes !== null && minutes < 0) {
    fieldErrors.brewMinutes = "Minutes must be 0 or higher.";
  }

  if (seconds !== null && (seconds < 0 || seconds > 59)) {
    fieldErrors.brewSeconds = "Seconds must be between 0 and 59.";
  }

  const fieldOrder = ["beanId", "dose", "yield", "brewMinutes", "brewSeconds"];
  return fieldOrder.find((key) => fieldErrors[key]) ?? null;
}

function submitForm() {
  const firstInvalid = validate();

  if (firstInvalid) {
    const element = document.getElementById(firstInvalid);
    element?.scrollIntoView({ behavior: "smooth", block: "center" });
    element?.focus({ preventScroll: true });
    return;
  }

  emit("submit", {
    beanId: draft.beanId,
    brewedAt: fromDateTimeLocalInput(draft.brewedAt),
    method: draft.method,
    grinder: draft.grinder,
    dose: asNumber(draft.dose) ?? 0,
    yield: asNumber(draft.yield) ?? 0,
    brewTime:
      (asNumber(brewMinutes.value) ?? 0) * 60 +
      (asNumber(brewSeconds.value) ?? 0),
    pours: draft.pours,
    tastingNotes: draft.tastingNotes,
  });
}
</script>

<template>
  <form class="space-y-5" @submit.prevent="submitForm">
    <div class="surface-card space-y-4 px-5 py-5">
      <div>
        <label class="field-label" for="beanId">Bean</label>
        <select
          id="beanId"
          v-model="draft.beanId"
          class="field-input"
          :class="errorClass('beanId')"
          @change="clearError('beanId')"
        >
          <option value="">Select a bean</option>
          <option v-for="bean in beans" :key="bean.id" :value="bean.id">
            {{ bean.name }}{{ bean.region ? ` · ${bean.region}` : "" }}{{ bean.varietal ? ` · ${bean.varietal}` : "" }} · {{ bean.remaining }}g left
          </option>
        </select>
        <p v-if="fieldErrors.beanId" class="mt-1 text-xs text-coral-600">
          {{ fieldErrors.beanId }}
        </p>
        <p class="field-help">
          Only active beans with remaining stock are available here.
        </p>
      </div>

      <div class="grid xs:grid-cols-2 gap-4">
        <div class="flex flex-col">
          <label class="field-label" for="brewedAt">Brewed at</label>
          <input
            id="brewedAt"
            v-model="draft.brewedAt"
            type="datetime-local"
            class="field-input mt-auto"
          />
        </div>

        <div class="flex flex-col">
          <label class="field-label" for="method">Method</label>
          <select id="method" v-model="draft.method" class="field-input mt-auto">
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

      <div class="grid xs:grid-cols-2 gap-4">
        <div class="flex flex-col">
          <label class="field-label" for="dose">Dose (g)</label>
          <input
            id="dose"
            :value="draft.dose ?? ''"
            min="0.1"
            step="0.1"
            type="number"
            class="field-input mt-auto"
            :class="errorClass('dose')"
            placeholder="e.g. 15"
            @input="onDoseInput"
          />
          <p v-if="fieldErrors.dose" class="mt-1 text-xs text-coral-600">
            {{ fieldErrors.dose }}
          </p>
        </div>

        <div class="flex flex-col">
          <label class="field-label" for="ratio">Ratio</label>
          <div class="field-input-group mt-auto">
            <span class="shrink-0 whitespace-nowrap text-sm font-medium text-espresso-500">1 :</span>
            <input
              id="ratio"
              :value="ratioInput ?? ''"
              min="0.1"
              step="0.1"
              type="number"
              placeholder="e.g. 15"
              @input="onRatioInput"
            />
          </div>
        </div>
      </div>

      <div class="grid xs:grid-cols-2 gap-4">
        <div class="flex flex-col">
          <label class="field-label" for="yield">Yield (g)</label>
          <input
            id="yield"
            :value="draft.yield ?? ''"
            min="0.1"
            step="0.1"
            type="number"
            class="field-input mt-auto"
            :class="errorClass('yield')"
            placeholder="e.g. 225"
            @input="onYieldInput"
          />
          <p v-if="fieldErrors.yield" class="mt-1 text-xs text-coral-600">
            {{ fieldErrors.yield }}
          </p>
        </div>

        <div class="flex flex-col">
          <label class="field-label" for="brewMinutes">Brew time</label>
          <div
            class="field-input-group mt-auto"
            :class="errorClassAny('brewMinutes', 'brewSeconds')"
          >
            <input
              id="brewMinutes"
              :value="brewMinutes ?? ''"
              min="0"
              step="1"
              type="number"
              placeholder="min"
              aria-label="Brew time minutes"
              @input="onMinutesInput"
            />
            <span class="shrink-0 text-sm font-medium text-espresso-500">:</span>
            <input
              id="brewSeconds"
              :value="brewSeconds ?? ''"
              min="0"
              max="59"
              step="1"
              type="number"
              placeholder="sec"
              aria-label="Brew time seconds"
              @input="onSecondsInput"
            />
          </div>
          <p
            v-if="fieldErrors.brewMinutes || fieldErrors.brewSeconds"
            class="mt-1 text-xs text-coral-600"
          >
            {{ fieldErrors.brewMinutes || fieldErrors.brewSeconds }}
          </p>
        </div>
      </div>

      <div>
        <div class="flex items-center justify-between">
          <label class="field-label" for="grinder">Grinder</label>
          <button
            type="button"
            class="text-xs font-medium uppercase tracking-[0.14em] text-espresso-500 hover:text-espresso-800"
            @click="isManagingGrinders = !isManagingGrinders"
          >
            {{ isManagingGrinders ? "Done" : "Manage" }}
          </button>
        </div>
        <select
          id="grinder"
          v-model="draft.grinder"
          class="field-input"
          @change="grinderTouched = true"
        >
          <option value="">No grinder</option>
          <option
            v-for="grinder in grinders"
            :key="grinder.id"
            :value="grinder.name"
          >
            {{ grinder.name }}
          </option>
          <option v-if="legacyGrinderName" :value="legacyGrinderName">
            {{ legacyGrinderName }}
          </option>
        </select>

        <div
          v-if="isManagingGrinders"
          class="mt-3 space-y-3 rounded-2xl bg-cream-50 px-4 py-4"
        >
          <div class="flex gap-3">
            <input
              v-model="newGrinderName"
              type="text"
              class="field-input"
              placeholder="e.g. 1zpresso ZP6"
              @keydown.enter.prevent="submitNewGrinder"
            />
            <button
              type="button"
              class="secondary-button shrink-0"
              @click="submitNewGrinder"
            >
              <Plus class="h-4 w-4" />
              Add
            </button>
          </div>

          <div v-if="grinders.length" class="flex flex-wrap gap-2">
            <button
              v-for="grinder in grinders"
              :key="grinder.id"
              type="button"
              class="badge bg-cream-100 text-espresso-800"
              @click="removeGrinderEntry(grinder)"
            >
              {{ grinder.name }}
              <X class="h-3.5 w-3.5" />
            </button>
          </div>
          <p v-else class="text-sm text-espresso-700">
            No grinders yet — add your first one above.
          </p>

          <p v-if="grinderError" class="text-xs text-coral-600">
            {{ grinderError }}
          </p>
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
          <p class="section-title">Tasting notes</p>
          <p class="mt-2 text-sm text-espresso-700">
            Add notes one by one. They will be stored in a normalized format for
            insights.
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
          ref="noteInputRef"
          v-model="noteInput"
          type="text"
          class="field-input"
          placeholder="e.g. citrus"
          @keydown.enter.prevent="addNote"
        />
        <button
          type="button"
          class="secondary-button shrink-0"
          @click="addNote"
        >
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

      <div
        class="mt-5 rounded-2xl bg-cream-50 px-4 py-4 text-sm text-espresso-700"
      >
        <p>
          Saving this brew deducts the dose from your stash.
          <span v-if="selectedBean" class="font-medium text-espresso-900">
            {{ selectedBean.remaining }}g is currently available for
            {{ selectedBean.name }}.
          </span>
        </p>
      </div>
    </div>

    <button
      type="submit"
      class="primary-button w-full"
      :disabled="isSubmitting || beans.length === 0"
    >
      {{ submitLabel ?? "Save brew" }}
    </button>
  </form>
</template>
