export interface Point {
  x: number
  y: number
}

export type Corners = [Point, Point, Point, Point]

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OpenCv = any

let cvPromise: Promise<OpenCv> | null = null

async function loadCv(): Promise<OpenCv> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const importedModule: any = await import('@techstark/opencv-js')
  const cv = importedModule.default ?? importedModule

  if (typeof cv.then === 'function') {
    return cv
  }

  if (cv.calledRun) {
    return cv
  }

  return new Promise((resolve) => {
    cv.onRuntimeInitialized = () => resolve(cv)
  })
}

async function getCv(): Promise<OpenCv> {
  if (!cvPromise) {
    cvPromise = loadCv()
  }

  return cvPromise
}

const FALLBACK_INSET_RATIO = 0.06

export function getFallbackCorners(width: number, height: number): Corners {
  const insetX = Math.round(width * FALLBACK_INSET_RATIO)
  const insetY = Math.round(height * FALLBACK_INSET_RATIO)

  return [
    { x: insetX, y: insetY },
    { x: width - insetX, y: insetY },
    { x: width - insetX, y: height - insetY },
    { x: insetX, y: height - insetY }
  ]
}

function orderCorners(points: Point[]): Corners {
  const sums = points.map((point) => point.x + point.y)
  const diffs = points.map((point) => point.y - point.x)

  return [
    points[sums.indexOf(Math.min(...sums))]!, // top-left: smallest x+y
    points[diffs.indexOf(Math.min(...diffs))]!, // top-right: smallest y-x
    points[sums.indexOf(Math.max(...sums))]!, // bottom-right: largest x+y
    points[diffs.indexOf(Math.max(...diffs))]! // bottom-left: largest y-x
  ]
}

// Bound the search to a plausible size band. The upper bound is generous: users often
// frame the label so it fills most of the shot, so only reject a region that is basically
// the entire frame (which usually means detection latched onto the whole bag/background).
const MIN_LABEL_AREA_RATIO = 0.015
const MAX_LABEL_AREA_RATIO = 0.95
// Labels are broadly rectangular; drop blobs that are extreme slivers.
const MIN_LABEL_ASPECT = 1.1
const MAX_LABEL_ASPECT = 8
// The printed sticker is near-white while the bag itself is often light grey, so a global
// Otsu split lumps them together. Threshold at a high brightness percentile instead - it
// adapts to each photo's exposure and keeps only the brightest region (the sticker).
const LABEL_BRIGHTNESS_PERCENTILE = 0.9
const MIN_BRIGHTNESS_THRESHOLD = 150
const MAX_BRIGHTNESS_THRESHOLD = 240

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function percentileThreshold(blurred: any): number {
  const data: Uint8Array = blurred.data
  const histogram = new Array<number>(256).fill(0)

  for (let i = 0; i < data.length; i++) {
    histogram[data[i]!]! += 1
  }

  let cumulative = 0
  let threshold = MAX_BRIGHTNESS_THRESHOLD

  for (let value = 0; value < 256; value++) {
    cumulative += histogram[value]!

    if (cumulative / data.length >= LABEL_BRIGHTNESS_PERCENTILE) {
      threshold = value
      break
    }
  }

  return Math.min(MAX_BRIGHTNESS_THRESHOLD, Math.max(MIN_BRIGHTNESS_THRESHOLD, threshold))
}

// Expand the detected rectangle outward before cropping so slightly-off edges don't clip
// the outermost characters (which wrecks OCR of the first/last glyph on a line).
const LABEL_PAD_RATIO = 1.08

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rotatedRectToCorners(rect: any): Corners {
  const angle = (rect.angle * Math.PI) / 180
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const halfWidth = (rect.size.width * LABEL_PAD_RATIO) / 2
  const halfHeight = (rect.size.height * LABEL_PAD_RATIO) / 2

  const offsets: Array<[number, number]> = [
    [-halfWidth, -halfHeight],
    [halfWidth, -halfHeight],
    [halfWidth, halfHeight],
    [-halfWidth, halfHeight]
  ]

  const points = offsets.map(([dx, dy]) => ({
    x: rect.center.x + dx * cos - dy * sin,
    y: rect.center.y + dx * sin + dy * cos
  }))

  return orderCorners(points)
}

/**
 * Detects the bright printed label/sticker on the bag: Otsu-threshold the greyscale
 * image to isolate near-white regions, morphologically close the text holes so the
 * sticker forms one solid blob, then take the min-area rectangle of the largest blob
 * inside a plausible size/aspect band. Returns null when nothing plausible is found -
 * the caller falls back to `getFallbackCorners` and lets the user drag the corners.
 */
export async function detectLabelCorners(source: HTMLCanvasElement): Promise<Corners | null> {
  const cv = await getCv()
  const src = cv.imread(source)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const thresh = new cv.Mat()
  const morphed = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const kernel = cv.Mat.ones(9, 9, cv.CV_8U)

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.threshold(blurred, thresh, percentileThreshold(blurred), 255, cv.THRESH_BINARY)
    cv.morphologyEx(thresh, morphed, cv.MORPH_CLOSE, kernel)
    cv.findContours(morphed, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE)

    const imageArea = source.width * source.height
    const minArea = imageArea * MIN_LABEL_AREA_RATIO
    const maxArea = imageArea * MAX_LABEL_AREA_RATIO

    let bestCorners: Corners | null = null
    let bestArea = 0

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i)

      try {
        const area = Math.abs(cv.contourArea(contour))

        if (area < minArea || area > maxArea || area <= bestArea) {
          continue
        }

        const rect = cv.minAreaRect(contour)
        const longSide = Math.max(rect.size.width, rect.size.height)
        const shortSide = Math.max(1, Math.min(rect.size.width, rect.size.height))
        const aspect = longSide / shortSide

        if (aspect < MIN_LABEL_ASPECT || aspect > MAX_LABEL_ASPECT) {
          continue
        }

        // Reject blobs that only fill a small fraction of their bounding rectangle
        // (ragged background texture rather than a solid printed sticker).
        const rectArea = rect.size.width * rect.size.height

        if (rectArea > 0 && area / rectArea < 0.6) {
          continue
        }

        bestArea = area
        bestCorners = rotatedRectToCorners(rect)
      }
      finally {
        contour.delete()
      }
    }

    return bestCorners
  }
  finally {
    src.delete()
    gray.delete()
    blurred.delete()
    thresh.delete()
    morphed.delete()
    contours.delete()
    hierarchy.delete()
    kernel.delete()
  }
}

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Un-skews the region bounded by `corners` into an axis-aligned canvas, sized from
 * the corners' own edge lengths (classic four-point transform).
 */
export async function warpPerspective(source: HTMLCanvasElement, corners: Corners): Promise<HTMLCanvasElement> {
  const cv = await getCv()
  const [topLeft, topRight, bottomRight, bottomLeft] = corners

  const outputWidth = Math.max(1, Math.round(Math.max(distance(topLeft, topRight), distance(bottomLeft, bottomRight))))
  const outputHeight = Math.max(1, Math.round(Math.max(distance(topLeft, bottomLeft), distance(topRight, bottomRight))))

  const src = cv.imread(source)
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    topLeft.x, topLeft.y,
    topRight.x, topRight.y,
    bottomRight.x, bottomRight.y,
    bottomLeft.x, bottomLeft.y
  ])
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    0, 0,
    outputWidth - 1, 0,
    outputWidth - 1, outputHeight - 1,
    0, outputHeight - 1
  ])
  const transformMatrix = cv.getPerspectiveTransform(srcTri, dstTri)
  const dst = new cv.Mat()

  try {
    cv.warpPerspective(src, dst, transformMatrix, new cv.Size(outputWidth, outputHeight))

    const outputCanvas = document.createElement('canvas')
    outputCanvas.width = outputWidth
    outputCanvas.height = outputHeight
    cv.imshow(outputCanvas, dst)

    return outputCanvas
  }
  finally {
    src.delete()
    srcTri.delete()
    dstTri.delete()
    transformMatrix.delete()
    dst.delete()
  }
}
