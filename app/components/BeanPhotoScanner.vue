<script setup lang="ts">
import { Camera, ImagePlus } from '@lucide/vue'
import type { PhotoScanResult } from '~/composables/usePhotoScan'

const emit = defineEmits<{
  scanned: [PhotoScanResult]
  busy: [boolean]
}>()

const {
  stage,
  errorMessage,
  ocrProgress,
  previewUrl,
  imageWidth,
  imageHeight,
  corners,
  cropSupported,
  isBusy,
  result,
  startScan,
  updateCorners,
  confirmCrop,
  skipCropping,
  retake,
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

const ocrProgressPercent = computed(() => Math.round(ocrProgress.value * 100))
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
        We'll try to read the label and fill in fields you haven't already typed. The first scan
        downloads a one-time toolkit, then works offline.
      </p>
    </div>

    <div v-else-if="stage === 'loading-libraries' || stage === 'detecting-corners'" class="flex items-center gap-3 py-2">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-espresso-300 border-t-transparent" />
      <p class="field-help">
        Reading the photo…
      </p>
    </div>

    <PhotoCornerEditor
      v-else-if="stage === 'adjusting-corners' && cropSupported && previewUrl && corners"
      :image-url="previewUrl"
      :image-width="imageWidth"
      :image-height="imageHeight"
      :corners="corners"
      @update:corners="updateCorners"
      @confirm="confirmCrop"
      @cancel="retake"
    />

    <div v-else-if="stage === 'adjusting-corners'" class="flex items-center gap-3 py-2">
      <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-espresso-300 border-t-transparent" />
      <p class="field-help">
        Preparing the photo…
      </p>
    </div>

    <div v-else-if="stage === 'processing-ocr'" class="space-y-2 py-2">
      <div class="flex items-center gap-3">
        <span class="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-espresso-300 border-t-transparent" />
        <p class="field-help">
          Reading the label… this can take a few seconds ({{ ocrProgressPercent }}%)
        </p>
      </div>
    </div>

    <div v-else-if="stage === 'done'" class="flex items-center justify-between gap-3">
      <p class="field-help">
        Photo captured. Fields below were filled in where possible - please review them.
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

    <button
      v-if="stage === 'adjusting-corners' && cropSupported"
      type="button"
      class="ghost-button w-full"
      @click="skipCropping"
    >
      Skip cropping, use full photo
    </button>
  </div>
</template>
