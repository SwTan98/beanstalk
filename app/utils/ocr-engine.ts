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
    workerPromise = import('tesseract.js').then(async ({ createWorker, PSM }) => {
      const baseURL = resolveAssetBaseURL()

      const worker = await createWorker('eng', 1, {
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

      // A bean label is one contiguous block; SINGLE_BLOCK stops Tesseract from
      // mis-segmenting the two-column header and the "[Key] value" rows, which
      // markedly improves accuracy over the default auto page-segmentation mode.
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_BLOCK })

      return worker
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
