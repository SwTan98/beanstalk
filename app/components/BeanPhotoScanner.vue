<script setup lang="ts">
import { Camera, ImagePlus } from '@lucide/vue'
import type { LabelParseResult } from '~/utils/bean-label-parser'

const emit = defineEmits<{
  scanned: [LabelParseResult]
  busy: [boolean]
}>()

const {
  stage,
  errorMessage,
  downloadProgress,
  result,
  isBusy,
  startScan,
  reset
} = usePhotoScan()

const cameraInputRef = ref<HTMLInputElement | null>(null)
const galleryInputRef = ref<HTMLInputElement | null>(null)

watch(isBusy, (value) => emit('busy', value))

watch(stage, (value) => {
  if (value === 'done' && result.value) {
    emit('scanned', result.value)
  }
})

function openCamera() {
  cameraInputRef.value?.click()
}

function openGallery() {
  galleryInputRef.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0] ?? null
  input.value = ''

  if (file) {
    await startScan(file)
  }
}

const downloadPercent = computed(() => Math.round(downloadProgress.value * 100))
</script>

<template>
  <div class="surface-card space-y-4 px-5 py-5">
    <input
      ref="cameraInputRef"
      type="file"
      accept="image/*"
      capture="environment"
      class="hidden"
      @change="onFileSelected"
    >
    <input
      ref="galleryInputRef"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onFileSelected"
    >

    <div v-if="stage === 'idle'" class="space-y-3">
      <p class="field-label">
        Scan a bag photo
      </p>
      <div class="flex gap-2">
        <button type="button" class="secondary-button flex-1" @click="openCamera">
          <Camera class="h-4 w-4" />
          Take photo
        </button>
        <button type="button" class="secondary-button flex-1" @click="openGallery">
          <ImagePlus class="h-4 w-4" />
          Choose from gallery
        </button>
      </div>
      <p class="field-help">
        We'll read the label and fill in the form - scanning replaces anything already entered.
        The first scan downloads a one-time toolkit, then works offline.
      </p>
    </div>

    <div v-else-if="stage === 'preparing'" class="flex items-center gap-3 py-2">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-espresso-300 border-t-transparent" />
      <p class="field-help">
        Reading the photo…
      </p>
    </div>

    <div v-else-if="stage === 'downloading-models'" class="space-y-2 py-2">
      <p class="field-help">
        Downloading the one-time scanner toolkit (~43 MB)… {{ downloadPercent }}%
      </p>
      <div class="h-2 w-full overflow-hidden rounded-full bg-espresso-100">
        <div
          class="h-full rounded-full bg-espresso-400 transition-all duration-200"
          :style="{ width: `${downloadPercent}%` }"
        />
      </div>
    </div>

    <div v-else-if="stage === 'recognizing'" class="flex items-center gap-3 py-2">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-espresso-300 border-t-transparent" />
      <p class="field-help">
        Reading the label… this can take a few seconds
      </p>
    </div>

    <div v-else-if="stage === 'done'" class="flex items-center justify-between gap-3">
      <p class="field-help">
        Photo scanned. The fields below were replaced with what we could read - please review them.
      </p>
      <button type="button" class="ghost-button" @click="reset">
        Rescan
      </button>
    </div>

    <div v-else-if="stage === 'error'" class="space-y-3">
      <p class="rounded-2xl bg-coral-100 px-4 py-3 text-sm text-coral-600">
        {{ errorMessage }}
      </p>
      <button type="button" class="secondary-button" @click="reset">
        Try again
      </button>
    </div>
  </div>
</template>
