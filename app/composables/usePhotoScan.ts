import type { LabelParseResult } from '~/utils/bean-label-parser'
import { ensureOcrReady, recognizeBagPhoto } from '~/utils/ocr-engine'
import {
  parseLabelBasic,
  parseLabelFromImage,
  parseLabelSmart,
  type LabelImagePayload,
  type LabelParseSource
} from '~/composables/useLabelParse'

export type PhotoScanStage =
  | 'idle'
  | 'preparing'
  | 'analyzing'
  | 'downloading-models'
  | 'recognizing'
  | 'done'
  | 'error'

const MAX_CANVAS_DIMENSION = 1600
const JPEG_QUALITY = 0.8
// Mirrors MAX_IMAGE_BASE64_LENGTH in server/api/parse-label.post.ts: don't
// upload a payload the server is guaranteed to reject.
const MAX_IMAGE_BASE64_LENGTH = 4_000_000

function drawToCanvas(bitmap: ImageBitmap, maxDimension: number): HTMLCanvasElement {
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))

  const context = canvas.getContext('2d')

  if (!context) {
    throw new Error('Canvas 2D context is unavailable.')
  }

  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

// JPEG at the canvas's own dimensions (max 1600px): already proven sufficient
// for reading label text via OCR, so sufficient for Gemini's vision too. The
// canvas round-trip also normalizes camera formats Gemini doesn't accept
// (e.g. HEIC) and applies EXIF orientation.
function canvasToJpegPayload(canvas: HTMLCanvasElement): LabelImagePayload {
  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
  const data = dataUrl.slice(dataUrl.indexOf(',') + 1)

  if (!data || data.length > MAX_IMAGE_BASE64_LENGTH) {
    throw new Error('Encoded photo is empty or too large to upload.')
  }

  return { data, mimeType: 'image/jpeg' }
}

// Fire-and-forget OCR model download after a successful image-mode scan.
// Without it, an image-mode user might never trigger the one-time ~43 MB
// download online and then have their first offline scan fail - today's flow
// caches the models on the very first scan, and that guarantee must hold.
// Idempotent: ensureOcrReady dedups via its module-level promise and stores
// the models in the Cache API.
function warmOcrCache() {
  ensureOcrReady().catch(() => {})
}

export function usePhotoScan() {
  // Baked into the client bundle at build time from GEMINI_IMAGE_PARSE (see
  // nuxt.config.ts). Read here in setup scope, not inside startScan.
  const imageParseEnabled = useRuntimeConfig().public.geminiImageParse

  const stage = ref<PhotoScanStage>('idle')
  const errorMessage = ref('')
  const downloadProgress = ref(0)
  const result = ref<LabelParseResult | null>(null)
  const scanSource = ref<LabelParseSource>('deterministic')

  const isBusy = computed(() => stage.value !== 'idle' && stage.value !== 'done' && stage.value !== 'error')

  function reset() {
    stage.value = 'idle'
    errorMessage.value = ''
    downloadProgress.value = 0
    result.value = null
    scanSource.value = 'deterministic'
  }

  async function startScan(file: File) {
    reset()
    stage.value = 'preparing'

    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      const canvas = drawToCanvas(bitmap, MAX_CANVAS_DIMENSION)
      bitmap.close()

      // Image mode: skip OCR entirely and let Gemini read the photo. Only an
      // explicit navigator.onLine === false means offline - environments
      // without the API should still attempt the call.
      if (imageParseEnabled && !(typeof navigator !== 'undefined' && navigator.onLine === false)) {
        try {
          stage.value = 'analyzing'
          result.value = await parseLabelFromImage(canvasToJpegPayload(canvas))
          scanSource.value = 'gemini-image'
          stage.value = 'done'
          warmOcrCache()
          return
        }
        catch {
          // Expected failure mode (timeout, 4xx/5xx including a flag-off
          // server rejecting a stale client, rate limit, encode failure) -
          // degrade silently to the OCR path below.
        }
      }

      // OCR path: the fallback when image mode fails, and the only path when
      // image mode is off or the device is offline.
      // The engine only reports progress for real network downloads, so a
      // cached load never enters the downloading stage.
      await ensureOcrReady((fraction) => {
        stage.value = 'downloading-models'
        downloadProgress.value = fraction
      })

      stage.value = 'recognizing'
      const lines = await recognizeBagPhoto(canvas)
      // In image mode the fallback is deterministic-only: no second Gemini
      // call (see parseLabelBasic). Otherwise the legacy text-mode flow runs
      // unchanged.
      const parsed = imageParseEnabled ? parseLabelBasic(lines) : await parseLabelSmart(lines)
      result.value = parsed.result
      scanSource.value = parsed.source
      stage.value = 'done'
    }
    catch (error) {
      console.error('Photo scan failed', error)
      errorMessage.value = 'Could not process that photo. You can still fill in the form manually.'
      stage.value = 'error'
    }
  }

  return {
    stage,
    errorMessage,
    downloadProgress,
    result,
    scanSource,
    isBusy,
    startScan,
    reset
  }
}
