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

function matToPoints(mat: OpenCv): Point[] {
  const points: Point[] = []

  for (let row = 0; row < mat.rows; row++) {
    points.push({
      x: mat.data32S[row * 2],
      y: mat.data32S[row * 2 + 1]
    })
  }

  return points
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

const MIN_CONTOUR_AREA_RATIO = 0.2

/**
 * Detects the largest convex quadrilateral in the image (Canny edges -> contours ->
 * approxPolyDP), on the assumption it's the bag/label. Returns null when nothing
 * plausible is found - the caller should fall back to `getFallbackCorners` and let
 * the user manually adjust, since this frequently misses on curved/wrinkled bags.
 */
export async function detectDocumentCorners(source: HTMLCanvasElement): Promise<Corners | null> {
  const cv = await getCv()
  const src = cv.imread(source)
  const gray = new cv.Mat()
  const blurred = new cv.Mat()
  const edges = new cv.Mat()
  const dilated = new cv.Mat()
  const contours = new cv.MatVector()
  const hierarchy = new cv.Mat()
  const kernel = cv.Mat.ones(3, 3, cv.CV_8U)

  try {
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0)
    cv.Canny(blurred, edges, 75, 200)
    cv.dilate(edges, dilated, kernel)
    cv.findContours(dilated, contours, hierarchy, cv.RETR_LIST, cv.CHAIN_APPROX_SIMPLE)

    const imageArea = source.width * source.height
    let bestQuad: Corners | null = null
    let bestArea = imageArea * MIN_CONTOUR_AREA_RATIO

    for (let i = 0; i < contours.size(); i++) {
      const contour = contours.get(i)
      const approx = new cv.Mat()

      try {
        const perimeter = cv.arcLength(contour, true)
        cv.approxPolyDP(contour, approx, 0.02 * perimeter, true)

        if (approx.rows === 4 && cv.isContourConvex(approx)) {
          const area = Math.abs(cv.contourArea(approx))

          if (area > bestArea) {
            bestArea = area
            bestQuad = orderCorners(matToPoints(approx))
          }
        }
      }
      finally {
        approx.delete()
        contour.delete()
      }
    }

    return bestQuad
  }
  finally {
    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    dilated.delete()
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
