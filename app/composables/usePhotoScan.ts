import type { LabelParseResult } from '~/utils/bean-label-parser'
import { ensureOcrReady, recognizeBagPhoto } from '~/utils/ocr-engine'
import { parseLabelSmart, type LabelParseSource } from '~/composables/useLabelParse'

export type PhotoScanStage =
  | 'idle'
  | 'preparing'
  | 'downloading-models'
  | 'recognizing'
  | 'done'
  | 'error'

const MAX_CANVAS_DIMENSION = 1600

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

export function usePhotoScan() {
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

      // The engine only reports progress for real network downloads, so a
      // cached load never enters the downloading stage.
      await ensureOcrReady((fraction) => {
        stage.value = 'downloading-models'
        downloadProgress.value = fraction
      })

      stage.value = 'recognizing'
      const lines = await recognizeBagPhoto(canvas)
      const parsed = await parseLabelSmart(lines)
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
