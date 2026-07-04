import { useRuntimeConfig } from '#imports'
import type Tesseract from 'tesseract.js'

let workerPromise: Promise<Tesseract.Worker> | null = null
let progressCallback: ((progress: number) => void) | null = null

function resolveAssetBaseURL() {
  const { app } = useRuntimeConfig()
  const base = app.baseURL.endsWith('/') ? app.baseURL : `${app.baseURL}/`
  return `${window.location.origin}${base}`
}

async function getWorker(): Promise<Tesseract.Worker> {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => {
      const baseURL = resolveAssetBaseURL()

      return createWorker('eng', 1, {
        workerPath: `${baseURL}tesseract/worker.min.js`,
        corePath: `${baseURL}tesseract/core`,
        langPath: `${baseURL}tesseract/lang`,
        gzip: true,
        logger: (message) => {
          if (message.status === 'recognizing text') {
            progressCallback?.(message.progress)
          }
        }
      })
    })
  }

  return workerPromise
}

export async function recognizeText(
  image: Blob | HTMLCanvasElement,
  onProgress?: (progress: number) => void
): Promise<string> {
  const worker = await getWorker()
  progressCallback = onProgress ?? null

  try {
    const { data } = await worker.recognize(image)
    return data.text
  }
  finally {
    progressCallback = null
  }
}
