import { parseBeanLabelText, type ParsedBeanFields } from '~/utils/bean-label-parser'
import { recognizeText } from '~/utils/ocr-engine'
import { detectLabelCorners, getFallbackCorners, warpPerspective, type Corners } from '~/utils/opencv-perspective'

export type PhotoScanStage =
  | 'idle'
  | 'loading-libraries'
  | 'detecting-corners'
  | 'adjusting-corners'
  | 'processing-ocr'
  | 'done'
  | 'error'

export interface PhotoScanResult {
  parsedFields: ParsedBeanFields
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

// The photo is kept at full resolution (capped only to avoid absurd memory use) for the
// actual crop, so the label keeps every pixel the camera captured. Detection and the
// draggable preview run on a smaller downscaled copy for speed.
const MAX_FULL_DIMENSION = 4096
const MAX_CANVAS_DIMENSION = 1600
// Feed OCR an image whose width lands in this band: upscale small crops so Tesseract has
// enough pixels per glyph, but downscale very large full-res crops so it stays fast.
const OCR_MIN_WIDTH = 1600
const OCR_MAX_WIDTH = 2400
// 3x3 sharpen kernel; crispens edges softened by the upscale, which measurably improves
// recognition (e.g. "Kempe" -> "Kenya") on small labels.
const SHARPEN_KERNEL = [0, -1, 0, -1, 5, -1, 0, -1, 0]

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

function sharpenCanvas(canvas: HTMLCanvasElement): void {
  const context = canvas.getContext('2d')

  if (!context) {
    return
  }

  const { width, height } = canvas
  const source = context.getImageData(0, 0, width, height)
  const output = context.createImageData(width, height)
  const src = source.data
  const dst = output.data

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      let ki = 0

      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const px = Math.min(width - 1, Math.max(0, x + kx))
          const py = Math.min(height - 1, Math.max(0, y + ky))
          const offset = (py * width + px) * 4
          const weight = SHARPEN_KERNEL[ki++]!

          r += src[offset]! * weight
          g += src[offset + 1]! * weight
          b += src[offset + 2]! * weight
        }
      }

      const offset = (y * width + x) * 4
      dst[offset] = clampByte(r)
      dst[offset + 1] = clampByte(g)
      dst[offset + 2] = clampByte(b)
      dst[offset + 3] = 255
    }
  }

  context.putImageData(output, 0, 0)
}

// Max deviation (radians) of the crop's top/left edges from horizontal/vertical for it to
// count as "flat" and be cropped without a perspective warp. ~7 degrees.
const AXIS_ALIGNED_TOLERANCE = 0.12

function isNearlyAxisAligned(corners: Corners): boolean {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  const topAngle = Math.abs(Math.atan2(topRight.y - topLeft.y, topRight.x - topLeft.x))
  const bottomAngle = Math.abs(Math.atan2(bottomRight.y - bottomLeft.y, bottomRight.x - bottomLeft.x))
  const leftAngle = Math.abs(Math.atan2(bottomLeft.x - topLeft.x, bottomLeft.y - topLeft.y))
  const rightAngle = Math.abs(Math.atan2(bottomRight.x - topRight.x, bottomRight.y - topRight.y))

  return (
    topAngle < AXIS_ALIGNED_TOLERANCE
    && bottomAngle < AXIS_ALIGNED_TOLERANCE
    && leftAngle < AXIS_ALIGNED_TOLERANCE
    && rightAngle < AXIS_ALIGNED_TOLERANCE
  )
}

function cropBoundingBox(canvas: HTMLCanvasElement, corners: Corners): HTMLCanvasElement {
  const xs = corners.map((point) => point.x)
  const ys = corners.map((point) => point.y)
  const x = Math.max(0, Math.floor(Math.min(...xs)))
  const y = Math.max(0, Math.floor(Math.min(...ys)))
  const width = Math.max(1, Math.min(canvas.width - x, Math.ceil(Math.max(...xs) - x)))
  const height = Math.max(1, Math.min(canvas.height - y, Math.ceil(Math.max(...ys) - y)))

  const cropped = document.createElement('canvas')
  cropped.width = width
  cropped.height = height

  const context = cropped.getContext('2d')

  if (!context) {
    return canvas
  }

  context.drawImage(canvas, x, y, width, height, 0, 0, width, height)
  return cropped
}

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

// Upscale + greyscale/contrast the cropped label before OCR. Small stickers read
// poorly at native resolution, and dropping colour removes glare/tint noise.
function ocrScale(width: number): number {
  if (width < OCR_MIN_WIDTH) {
    return OCR_MIN_WIDTH / width
  }

  if (width > OCR_MAX_WIDTH) {
    return OCR_MAX_WIDTH / width
  }

  return 1
}

function prepareForOcr(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const scale = ocrScale(canvas.width)
  const prepared = document.createElement('canvas')
  prepared.width = Math.max(1, Math.round(canvas.width * scale))
  prepared.height = Math.max(1, Math.round(canvas.height * scale))

  const context = prepared.getContext('2d')

  if (!context) {
    return canvas
  }

  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.filter = 'grayscale(1) contrast(1.4) brightness(1.05)'
  context.drawImage(canvas, 0, 0, prepared.width, prepared.height)
  context.filter = 'none'
  sharpenCanvas(prepared)
  return prepared
}

export function usePhotoScan() {
  const stage = ref<PhotoScanStage>('idle')
  const errorMessage = ref('')
  const ocrProgress = ref(0)
  const sourceCanvas = ref<HTMLCanvasElement | null>(null)
  const corners = ref<Corners | null>(null)
  const cropSupported = ref(true)
  const result = ref<PhotoScanResult | null>(null)
  // Full-resolution copy of the photo used only for the final crop. Not a ref - it never
  // needs to drive rendering, and keeping a multi-megapixel canvas reactive is wasteful.
  let fullResCanvas: HTMLCanvasElement | null = null

  const previewUrl = computed(() => sourceCanvas.value?.toDataURL('image/jpeg', 0.9) ?? null)
  const imageWidth = computed(() => sourceCanvas.value?.width ?? 0)
  const imageHeight = computed(() => sourceCanvas.value?.height ?? 0)
  const isBusy = computed(() => stage.value !== 'idle' && stage.value !== 'done' && stage.value !== 'error')

  function reset() {
    stage.value = 'idle'
    errorMessage.value = ''
    ocrProgress.value = 0
    sourceCanvas.value = null
    corners.value = null
    cropSupported.value = true
    result.value = null
    fullResCanvas = null
  }

  // Scales corners from the downscaled preview space up to the full-resolution photo, so
  // the crop is taken from the original pixels.
  function toFullResCorners(previewCorners: Corners): Corners {
    const preview = sourceCanvas.value

    if (!preview || !fullResCanvas || fullResCanvas.width === preview.width) {
      return previewCorners
    }

    const ratio = fullResCanvas.width / preview.width
    return previewCorners.map((point) => ({ x: point.x * ratio, y: point.y * ratio })) as Corners
  }

  async function finishProcessing(canvas: HTMLCanvasElement) {
    stage.value = 'processing-ocr'
    ocrProgress.value = 0

    let parsedFields = EMPTY_PARSED_FIELDS

    try {
      const prepared = prepareForOcr(canvas)
      const text = await recognizeText(prepared, (value) => {
        ocrProgress.value = value
      })
      parsedFields = parseBeanLabelText(text)
    }
    catch (error) {
      console.error('OCR failed, continuing without prefilled fields:', error)
    }

    result.value = { parsedFields }
    stage.value = 'done'
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

    const fullCanvas = drawToCanvas(bitmap, MAX_FULL_DIMENSION)
    // Reuse the full-res canvas as the preview when the photo is already small enough,
    // otherwise make a lighter downscaled copy for detection and the corner editor.
    const canvas = fullCanvas.width <= MAX_CANVAS_DIMENSION && fullCanvas.height <= MAX_CANVAS_DIMENSION
      ? fullCanvas
      : drawToCanvas(bitmap, MAX_CANVAS_DIMENSION)
    bitmap.close()
    fullResCanvas = fullCanvas
    sourceCanvas.value = canvas

    stage.value = 'detecting-corners'

    try {
      const detected = await detectLabelCorners(canvas)
      corners.value = detected ?? getFallbackCorners(canvas.width, canvas.height)
      stage.value = 'adjusting-corners'
    }
    catch (error) {
      console.error('OpenCV unavailable, skipping the crop step:', error)
      cropSupported.value = false
      await finishProcessing(fullResCanvas)
    }
  }

  function updateCorners(next: Corners) {
    corners.value = next
  }

  async function confirmCrop() {
    if (!sourceCanvas.value || !corners.value || !fullResCanvas) {
      return
    }

    const fullCorners = toFullResCorners(corners.value)
    let finalCanvas = fullResCanvas

    try {
      // A perspective warp resamples (and blurs) the whole crop. When the label is already
      // close to axis-aligned - the common flat-on-a-table case - a plain rectangular crop
      // preserves the original pixels and reads noticeably better. Only warp when the photo
      // was taken at enough of an angle to actually need un-skewing.
      finalCanvas = isNearlyAxisAligned(fullCorners)
        ? cropBoundingBox(fullResCanvas, fullCorners)
        : await warpPerspective(fullResCanvas, fullCorners)
    }
    catch (error) {
      console.error('Crop failed, using the uncropped photo:', error)
    }

    await finishProcessing(finalCanvas)
  }

  async function skipCropping() {
    if (!fullResCanvas) {
      return
    }

    await finishProcessing(fullResCanvas)
  }

  function retake() {
    reset()
  }

  return {
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
  }
}
