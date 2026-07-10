import type { PaddleOcrService } from 'ppu-paddle-ocr/web'

export interface OcrBox {
  x: number
  y: number
  width: number
  height: number
}

export interface OcrLine {
  text: string
  box: OcrBox
  confidence: number
}

const MIN_LINE_CONFIDENCE = 0.5

// Fallback byte sizes used for download progress when a response has no
// Content-Length header (e.g. compressed transfer in dev).
const MODEL_FILES = [
  { path: 'ocr/models/PP-OCRv6_small_det.ort', approximateBytes: 10_000_000 },
  { path: 'ocr/models/PP-OCRv6_small_rec.ort', approximateBytes: 21_300_000 },
  { path: 'ocr/models/ppocrv6_dict.txt', approximateBytes: 75_000 },
  { path: 'ocr/ort/ort-wasm-simd-threaded.wasm', approximateBytes: 13_500_000 },
  { path: 'ocr/ort/ort-wasm-simd-threaded.mjs', approximateBytes: 25_000 }
] as const

// Explicit Cache API storage for the model files, independent of the service
// worker: the vite-pwa dev SW doesn't apply runtime caching, and this also
// lets a fully-cached load skip the download-progress stage entirely.
const OCR_CACHE_NAME = 'beanstalk-ocr-v1'

let servicePromise: Promise<PaddleOcrService> | null = null

function resolveAssetBaseURL() {
  return `${window.location.origin}/`
}

async function openOcrCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') {
    return null
  }

  try {
    return await caches.open(OCR_CACHE_NAME)
  }
  catch {
    return null
  }
}

async function fetchWithProgress(url: string, approximateBytes: number, onBytes: (received: number, total: number) => void): Promise<ArrayBuffer> {
  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`Failed to download ${url} (${response.status})`)
  }

  const contentLength = Number(response.headers.get('Content-Length'))
  const total = Number.isFinite(contentLength) && contentLength > 0 ? contentLength : approximateBytes

  if (!response.body) {
    const buffer = await response.arrayBuffer()
    onBytes(total, total)
    return buffer
  }

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0

  while (true) {
    const { done, value } = await reader.read()

    if (done) {
      break
    }

    chunks.push(value)
    received += value.byteLength
    onBytes(Math.min(received, total), total)
  }

  onBytes(total, total)

  const buffer = new Uint8Array(received)
  let offset = 0

  for (const chunk of chunks) {
    buffer.set(chunk, offset)
    offset += chunk.byteLength
  }

  return buffer.buffer
}

// Loads all OCR assets, preferring the explicit cache. Progress is only
// reported for real network downloads - a fully-cached load stays silent so
// the UI can skip the download stage.
async function downloadModels(baseURL: string, onProgress?: (fraction: number) => void): Promise<ArrayBuffer[]> {
  const cache = await openOcrCache()
  const receivedByFile = MODEL_FILES.map(() => 0)
  const totalByFile = MODEL_FILES.map((file) => file.approximateBytes)

  const reportProgress = () => {
    const received = receivedByFile.reduce((sum, bytes) => sum + bytes, 0)
    const total = totalByFile.reduce((sum, bytes) => sum + bytes, 0)
    onProgress?.(total > 0 ? Math.min(1, received / total) : 0)
  }

  return Promise.all(MODEL_FILES.map(async (file, index) => {
    const url = `${baseURL}${file.path}`
    const cached = await cache?.match(url)

    if (cached) {
      const buffer = await cached.arrayBuffer()
      receivedByFile[index] = buffer.byteLength
      totalByFile[index] = buffer.byteLength
      return buffer
    }

    const buffer = await fetchWithProgress(url, file.approximateBytes, (received, total) => {
      receivedByFile[index] = received
      totalByFile[index] = total
      reportProgress()
    })

    try {
      await cache?.put(url, new Response(buffer))
    }
    catch {
      // Storage pressure or private-mode quota - scanning still works, the
      // next load just downloads again.
    }

    return buffer
  }))
}

async function createService(onDownloadProgress?: (fraction: number) => void): Promise<PaddleOcrService> {
  const baseURL = resolveAssetBaseURL()

  // onnxruntime-web must be configured before ppu-paddle-ocr/web is evaluated:
  // its platform module pins a jsdelivr CDN (for a different ORT version) as
  // the wasm path unless one is already set, which would break offline use.
  const ort = await import('onnxruntime-web')
  ort.env.wasm.wasmPaths = `${baseURL}ocr/ort/`
  // The host doesn't serve COOP/COEP headers (no cross-origin isolation), so
  // threaded wasm can't run anyway.
  ort.env.wasm.numThreads = 1

  const { PaddleOcrService: WebPaddleOcrService } = await import('ppu-paddle-ocr/web')

  const [detection, recognition, charactersDictionary, wasmBinary, wasmLoader] = await downloadModels(baseURL, onDownloadProgress)

  // Hand ort the wasm binary and its .mjs loader directly so it never issues
  // its own fetches - those are the assets the explicit cache couldn't
  // otherwise intercept, and they'd break scanning offline.
  if (wasmBinary) {
    ort.env.wasm.wasmBinary = wasmBinary
  }

  if (wasmLoader) {
    const loaderUrl = URL.createObjectURL(new Blob([wasmLoader], { type: 'text/javascript' }))
    ort.env.wasm.wasmPaths = { mjs: loaderUrl }
  }

  const service = new WebPaddleOcrService({
    model: { detection, recognition, charactersDictionary },
    // Bag labels are often a small region of the photo; the default 640px
    // detection pass misses their body text, so run detection at 960px.
    detection: { maxSideLength: 960 },
    session: { executionProviders: ['wasm'] }
  })

  await service.initialize()
  return service
}

async function getService(onDownloadProgress?: (fraction: number) => void): Promise<PaddleOcrService> {
  if (!servicePromise) {
    servicePromise = createService(onDownloadProgress).catch((error) => {
      servicePromise = null
      throw error
    })
  }

  return servicePromise
}

export async function ensureOcrReady(onDownloadProgress?: (fraction: number) => void): Promise<void> {
  await getService(onDownloadProgress)
}

function unionBoxes(boxes: OcrBox[]): OcrBox {
  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))

  return { x: left, y: top, width: right - left, height: bottom - top }
}

interface RecognizedItem {
  text: string
  box: OcrBox
  confidence: number
}

// Two-column labels ("Producer: | Variety:") share a visual row, so joining a
// whole row into one line glues unrelated columns together. Column gutters
// are much wider than word spaces (>=2x text height vs ~0.5x), so split a
// row's items into segments at wide horizontal gaps.
const COLUMN_GAP_HEIGHT_RATIO = 1.5

function splitRowIntoColumnSegments(items: RecognizedItem[]): RecognizedItem[][] {
  const segments: RecognizedItem[][] = []
  let current: RecognizedItem[] = []

  for (const item of items) {
    const previous = current[current.length - 1]

    if (previous) {
      const gap = item.box.x - (previous.box.x + previous.box.width)
      const gapThreshold = Math.max(previous.box.height, item.box.height) * COLUMN_GAP_HEIGHT_RATIO

      if (gap > gapThreshold) {
        segments.push(current)
        current = []
      }
    }

    current.push(item)
  }

  if (current.length > 0) {
    segments.push(current)
  }

  return segments
}

export async function recognizeBagPhoto(canvas: HTMLCanvasElement): Promise<OcrLine[]> {
  const service = await getService()
  // per-box recognizes each detected word individually - slower than the
  // default per-line merge, but more accurate and it preserves word breaks.
  const result = await service.recognize(canvas, { strategy: 'per-box' })

  return result.lines
    .filter((items) => items.length > 0)
    .flatMap((items) => splitRowIntoColumnSegments(items))
    .map((items) => ({
      text: items.map((item) => item.text).join(' ').trim(),
      box: unionBoxes(items.map((item) => item.box)),
      confidence: items.reduce((sum, item) => sum + item.confidence, 0) / items.length
    }))
    .filter((line) => line.text.length > 0 && line.confidence >= MIN_LINE_CONFIDENCE)
}
