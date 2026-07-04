import { parseBeanLabelWithLlm } from '~/utils/bean-label-llm-parser'
import { parseBeanLabelText, type ParsedBeanFields } from '~/utils/bean-label-parser'
import { isLlmSupported } from '~/utils/llm-engine'
import { recognizeText } from '~/utils/ocr-engine'
import { detectDocumentCorners, getFallbackCorners, warpPerspective, type Corners } from '~/utils/opencv-perspective'

export type PhotoScanStage =
  | 'idle'
  | 'loading-libraries'
  | 'detecting-corners'
  | 'adjusting-corners'
  | 'processing-ocr'
  | 'parsing-fields'
  | 'done'
  | 'error'

export interface PhotoScanResult {
  parsedFields: ParsedBeanFields
  photoBlob: Blob
}

const EMPTY_PARSED_FIELDS: ParsedBeanFields = {
  name: null,
  roaster: null,
  origin: null,
  region: null,
  varietal: null,
  process: null,
  roastProfile: null,
  startWeight: null
}

const MAX_CANVAS_DIMENSION = 1600
const JPEG_QUALITY = 0.85

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

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob)
      }
      else {
        reject(new Error('Failed to encode the photo.'))
      }
    }, 'image/jpeg', quality)
  })
}

export function usePhotoScan() {
  const stage = ref<PhotoScanStage>('idle')
  const errorMessage = ref('')
  const ocrProgress = ref(0)
  const llmProgress = ref(0)
  const sourceCanvas = ref<HTMLCanvasElement | null>(null)
  const corners = ref<Corners | null>(null)
  const cropSupported = ref(true)
  const result = ref<PhotoScanResult | null>(null)

  const previewUrl = computed(() => sourceCanvas.value?.toDataURL('image/jpeg', 0.9) ?? null)
  const imageWidth = computed(() => sourceCanvas.value?.width ?? 0)
  const imageHeight = computed(() => sourceCanvas.value?.height ?? 0)
  const isBusy = computed(() => stage.value !== 'idle' && stage.value !== 'done' && stage.value !== 'error')

  function reset() {
    stage.value = 'idle'
    errorMessage.value = ''
    ocrProgress.value = 0
    llmProgress.value = 0
    sourceCanvas.value = null
    corners.value = null
    cropSupported.value = true
    result.value = null
  }

  async function finishProcessing(canvas: HTMLCanvasElement) {
    stage.value = 'processing-ocr'
    ocrProgress.value = 0

    try {
      const photoBlob = await canvasToJpegBlob(canvas, JPEG_QUALITY)
      let parsedFields = EMPTY_PARSED_FIELDS
      let text = ''

      try {
        text = await recognizeText(canvas, (value) => {
          ocrProgress.value = value
        })
        parsedFields = parseBeanLabelText(text)
      }
      catch (error) {
        console.error('OCR failed, continuing without prefilled fields:', error)
      }

      if (text && isLlmSupported()) {
        stage.value = 'parsing-fields'
        llmProgress.value = 0

        try {
          parsedFields = await parseBeanLabelWithLlm(text, (value) => {
            llmProgress.value = value
          })
        }
        catch (error) {
          console.error('On-device LLM parsing failed, falling back to text-pattern results:', error)
        }
      }

      result.value = { parsedFields, photoBlob }
      stage.value = 'done'
    }
    catch (error) {
      stage.value = 'error'
      errorMessage.value = 'Could not process that photo. You can still fill in the form manually.'
      console.error('Photo processing failed:', error)
    }
  }

  async function startScan(file: File) {
    reset()
    stage.value = 'loading-libraries'

    let bitmap: ImageBitmap

    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    }
    catch (error) {
      stage.value = 'error'
      errorMessage.value = 'Could not read that image. Try a different photo.'
      console.error('Failed to decode selected image:', error)
      return
    }

    const canvas = drawToCanvas(bitmap, MAX_CANVAS_DIMENSION)
    bitmap.close()
    sourceCanvas.value = canvas

    stage.value = 'detecting-corners'

    try {
      const detected = await detectDocumentCorners(canvas)
      corners.value = detected ?? getFallbackCorners(canvas.width, canvas.height)
      stage.value = 'adjusting-corners'
    }
    catch (error) {
      console.error('OpenCV unavailable, skipping the crop step:', error)
      cropSupported.value = false
      await finishProcessing(canvas)
    }
  }

  function updateCorners(next: Corners) {
    corners.value = next
  }

  async function confirmCrop() {
    if (!sourceCanvas.value || !corners.value) {
      return
    }

    let finalCanvas = sourceCanvas.value

    try {
      finalCanvas = await warpPerspective(sourceCanvas.value, corners.value)
    }
    catch (error) {
      console.error('Perspective warp failed, using the uncropped photo:', error)
    }

    await finishProcessing(finalCanvas)
  }

  async function skipCropping() {
    if (!sourceCanvas.value) {
      return
    }

    await finishProcessing(sourceCanvas.value)
  }

  function retake() {
    reset()
  }

  return {
    stage,
    errorMessage,
    ocrProgress,
    llmProgress,
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
  }
}
