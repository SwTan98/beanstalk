// Primary parser for bag-label scans, with two mutually exclusive modes:
// - text mode ({ lines }): the client posts OCR lines and Gemini extracts the
//   bean fields - its result wins per field over the client's local
//   deterministic parse.
// - image mode ({ image }): the client posts the bag photo itself and Gemini
//   reads it directly - only accepted when the GEMINI_IMAGE_PARSE env flag is
//   on, so the flag stays a working kill switch even for stale cached PWA
//   clients.
// The app must keep working when this route is unreachable, unconfigured, or
// rate limited - clients degrade silently to the deterministic result.

import { GEMINI_UPSTREAM_TIMEOUT_MS } from '#shared/utils/timeouts'
import { isFlagEnabled } from '#shared/utils/flags'

interface ParseLabelLine {
  text: string
  confidence: number
}

interface ParseLabelImage {
  // Raw base64 payload, no data-URL prefix.
  data: string
  mimeType: string
}

interface ParseLabelBody {
  lines?: ParseLabelLine[]
  image?: ParseLabelImage
}

// Field names mirror BeanDraft in app/utils/types.ts verbatim. They are
// duplicated here (rather than imported) to keep the server layer free of
// app-directory dependencies.
const ROAST_PROFILE_VALUES = ['light', 'light-medium', 'medium', 'medium-dark', 'dark'] as const

interface LlmLabelFields {
  name?: string | null
  roaster?: string | null
  origin?: string | null
  region?: string | null
  varietal?: string | null
  process?: string | null
  roastProfile?: string | null
  startWeight?: number | null
  roastDate?: string | null
  tastingNotes?: string[]
}

const MAX_LINES = 100
const MAX_TOTAL_TEXT_LENGTH = 8192
// ~3 MB decoded - comfortably under Vercel's ~4.5 MB request body limit with
// JSON overhead headroom. The client mirrors this cap before uploading.
const MAX_IMAGE_BASE64_LENGTH = 4_000_000
// Gemini-supported formats; the client only ever sends image/jpeg.
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/
const MAX_FIELD_LENGTH = 80
const MAX_TASTING_NOTES = 5
const MIN_PLAUSIBLE_GRAMS = 50
const MAX_PLAUSIBLE_GRAMS = 5000
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Google's own guidance: retry 429 (rate limited) and 503 (model overloaded)
// with backoff. Both return fast, so this doesn't meaningfully eat into the
// timeout budget above. Anything else (bad request, auth, unknown model, or
// a network-layer hang with no statusCode) isn't retried - it won't succeed
// on a second attempt.
const RETRY_STATUS_CODES = new Set([429, 503])
const MAX_ATTEMPTS = 2
const RETRY_DELAY_MS = 750

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

interface GeminiGenerateContentResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
}

// Retries transient failures (429/503) within a single shared deadline, so
// total time across all attempts still respects GEMINI_UPSTREAM_TIMEOUT_MS
// no matter how many retries happen - each attempt gets whatever time
// remains, not a fresh timeout of its own.
async function fetchGeminiWithRetry(url: string, apiKey: string, requestBody: Record<string, unknown>): Promise<GeminiGenerateContentResponse> {
  const deadline = Date.now() + GEMINI_UPSTREAM_TIMEOUT_MS

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const remaining = deadline - Date.now()

    if (remaining <= 0) {
      throw new Error('parse-label: no time remaining for gemini request')
    }

    try {
      return await $fetch<GeminiGenerateContentResponse>(url, {
        method: 'POST',
        timeout: remaining,
        headers: { 'x-goog-api-key': apiKey },
        body: requestBody
      })
    }
    catch (error) {
      const statusCode = (error as { statusCode?: number })?.statusCode
      const canRetry = attempt < MAX_ATTEMPTS && statusCode !== undefined && RETRY_STATUS_CODES.has(statusCode)

      if (!canRetry) {
        throw error
      }

      console.error(`parse-label: gemini returned ${statusCode}, retrying`)
      await wait(RETRY_DELAY_MS)
    }
  }

  // Unreachable: the loop above always returns or throws.
  throw new Error('parse-label: retry loop exited unexpectedly')
}

// In-memory per-IP rate limiting. This resets on every serverless cold start
// and is tracked per concurrent instance, so it's abuse damping rather than a
// hard quota - the real ceiling for a personal app is the Gemini daily quota
// (1,500 req/day free tier), nowhere near this hourly cap even now that the
// route is called on every online scan rather than just as an occasional
// fallback.
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 30
const RATE_LIMIT_MAX_KEYS = 1000
const requestLog = new Map<string, number[]>()

function isRateLimited(key: string): boolean {
  const now = Date.now()
  const recent = (requestLog.get(key) ?? []).filter((timestamp) => now - timestamp < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    requestLog.set(key, recent)
    return true
  }

  recent.push(now)
  requestLog.set(key, recent)

  // Bound memory: drop the oldest keys instead of growing without limit.
  while (requestLog.size > RATE_LIMIT_MAX_KEYS) {
    const oldestKey = requestLog.keys().next().value

    if (oldestKey === undefined) {
      break
    }

    requestLog.delete(oldestKey)
  }

  return false
}

function isValidLines(lines: unknown): lines is ParseLabelLine[] {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) {
    return false
  }

  let totalTextLength = 0

  for (const line of lines) {
    if (typeof line !== 'object' || line === null) {
      return false
    }

    if (typeof (line as ParseLabelLine).text !== 'string' || !Number.isFinite((line as ParseLabelLine).confidence)) {
      return false
    }

    totalTextLength += (line as ParseLabelLine).text.length
  }

  return totalTextLength <= MAX_TOTAL_TEXT_LENGTH
}

function isValidImage(image: unknown): image is ParseLabelImage {
  if (typeof image !== 'object' || image === null) {
    return false
  }

  const { data, mimeType } = image as ParseLabelImage

  if (typeof mimeType !== 'string' || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    return false
  }

  return typeof data === 'string'
    && data.length > 0
    && data.length <= MAX_IMAGE_BASE64_LENGTH
    && BASE64_PATTERN.test(data)
}

// The two modes are mutually exclusive: exactly one of lines/image must be
// present and valid.
function isValidBody(body: unknown): body is ParseLabelBody {
  if (typeof body !== 'object' || body === null) {
    return false
  }

  const { lines, image } = body as ParseLabelBody

  if (lines !== undefined && image !== undefined) {
    return false
  }

  if (lines !== undefined) {
    return isValidLines(lines)
  }

  return image !== undefined && isValidImage(image)
}

function sanitizeString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim().slice(0, MAX_FIELD_LENGTH)
  return trimmed || null
}

// Whitelist known keys and sanity-check every value: the model's structured
// output is a strong hint, never a guarantee.
function sanitizeLlmFields(rawText: string): LlmLabelFields {
  const unfenced = rawText.replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
  let parsed: unknown

  try {
    parsed = JSON.parse(unfenced)
  }
  catch {
    return {}
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {}
  }

  const raw = parsed as Record<string, unknown>
  const fields: LlmLabelFields = {}

  for (const key of ['name', 'roaster', 'origin', 'region', 'varietal', 'process'] as const) {
    const value = sanitizeString(raw[key])

    if (value) {
      fields[key] = value
    }
  }

  const roastProfile = sanitizeString(raw.roastProfile)?.toLowerCase()

  if (roastProfile && (ROAST_PROFILE_VALUES as readonly string[]).includes(roastProfile)) {
    fields.roastProfile = roastProfile
  }

  const startWeight = raw.startWeight

  if (typeof startWeight === 'number' && Number.isFinite(startWeight)
    && startWeight >= MIN_PLAUSIBLE_GRAMS && startWeight <= MAX_PLAUSIBLE_GRAMS) {
    fields.startWeight = startWeight
  }

  const roastDate = sanitizeString(raw.roastDate)

  if (roastDate && ISO_DATE_PATTERN.test(roastDate)) {
    fields.roastDate = roastDate
  }

  if (Array.isArray(raw.tastingNotes)) {
    // Always set the field, even when Gemini genuinely found none: an
    // omitted key (the model never answered) and an explicit empty array
    // (the model confirmed there are no tasting notes) need to stay
    // distinguishable to the client's merge logic.
    fields.tastingNotes = raw.tastingNotes
      .filter((note): note is string => typeof note === 'string')
      .map((note) => note.trim().toLowerCase().slice(0, MAX_FIELD_LENGTH))
      .filter((note) => note.length > 0)
      .slice(0, MAX_TASTING_NOTES)
  }

  return fields
}

function buildResponseSchema() {
  const nullableString = { type: 'STRING', nullable: true }

  return {
    type: 'OBJECT',
    properties: {
      name: nullableString,
      roaster: nullableString,
      origin: nullableString,
      region: nullableString,
      varietal: nullableString,
      process: nullableString,
      roastProfile: { type: 'STRING', enum: [...ROAST_PROFILE_VALUES], nullable: true },
      startWeight: { type: 'NUMBER', nullable: true },
      roastDate: { type: 'STRING', nullable: true, description: 'ISO 8601 date, YYYY-MM-DD' },
      tastingNotes: { type: 'ARRAY', items: { type: 'STRING' } }
    }
  }
}

// Chosen via the user's own prompt/temperature/thinking experimentation
// against gemini-3.1-flash-lite. Field semantics beyond bare names (units,
// enum values, the roastDate-vs-best-before distinction) rely on the
// responseSchema rather than being spelled out here - re-add detail here if
// a specific field starts drifting. roastDate is the one exception: without
// an explicit format, the model returns whatever format was printed on the
// label (e.g. "03/05/2026"), which ISO_DATE_PATTERN below then silently
// rejects, dropping the field on nearly every response.
const EXTRACTION_INSTRUCTION = 'Extract fields to JSON schema from noisy OCR lines, standardize capitalization. Format roastDate as YYYY-MM-DD, never a best-before or expiry date. Null if missing.'

// Image-mode variant: same schema-driven field semantics, same explicit
// roastDate formatting (see the comment above).
const IMAGE_EXTRACTION_INSTRUCTION = 'This is a photo of a coffee bag label. Extract fields to JSON schema, standardize capitalization. Format roastDate as YYYY-MM-DD, never a best-before or expiry date. Null if missing or unreadable.'

export default defineEventHandler(async (event) => {
  const clientKey = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

  if (isRateLimited(clientKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many scan requests. Try again later.' })
  }

  const body = await readBody(event).catch(() => null)

  if (!isValidBody(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected exactly one of { lines: { text, confidence }[] } or { image: { data, mimeType } } within size limits.' })
  }

  // Reject image requests whenever the flag is off so it works as a kill
  // switch: stale cached PWA clients fall back to their local OCR path on
  // this fast 400 and pick up the new bundle on next load (autoUpdate SW).
  if (body.image && !isFlagEnabled(process.env.GEMINI_IMAGE_PARSE)) {
    throw createError({ statusCode: 400, statusMessage: 'Image label parsing is not enabled.' })
  }

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw createError({ statusCode: 503, statusMessage: 'Label parsing service is not configured.' })
  }

  // Pinned rather than the gemini-flash-latest rolling alias: that alias
  // currently resolves to gemini-3.5-flash, which can't fully disable
  // "thinking" even with thinkingBudget: 0 below (only floors it), causing
  // ~20s+ responses that blew the timeout budget - and separately hit real
  // upstream 503 overload independent of our code. gemini-3.1-flash-lite
  // was confirmed available via the API's own ListModels endpoint (plain
  // "gemini-3.1-flash" does not exist - a 404 traced back to that) and
  // Flash-Lite variants run with thinking off by default. Re-evaluate if
  // this model is ever deprecated.
  const model = process.env.GEMINI_MODEL ?? 'gemini-3.1-flash-lite'

  let parts: Array<Record<string, unknown>>

  if (body.image) {
    parts = [
      { text: IMAGE_EXTRACTION_INSTRUCTION },
      { inlineData: { mimeType: body.image.mimeType, data: body.image.data } }
    ]
  }
  else {
    const linesText = body.lines!
      .map((line) => `${line.text} [${line.confidence.toFixed(2)}]`)
      .join('\n')

    parts = [{ text: `${EXTRACTION_INSTRUCTION}\n\nOCR lines:\n${linesText}` }]
  }

  let responseText: string | undefined

  try {
    const response = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      apiKey,
      {
        contents: [
          {
            role: 'user',
            parts
          }
        ],
        generationConfig: {
          // temperature/thinkingBudget chosen via the user's own
          // experimentation against gemini-3.1-flash-lite: fully
          // deterministic output, thinking off.
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema: buildResponseSchema(),
          thinkingConfig: {
            thinkingBudget: 0
          }
        }
      }
    )

    responseText = response.candidates?.[0]?.content?.parts?.[0]?.text
  }
  catch (error) {
    // Never log the OCR contents, the image data, or the provider response
    // body.
    const statusCode = (error as { statusCode?: number })?.statusCode
    console.error(`parse-label: provider request failed (status ${statusCode ?? 'unknown'})`)
    throw createError({ statusCode: 502, statusMessage: 'Label parsing service is unavailable.' })
  }

  if (!responseText) {
    throw createError({ statusCode: 502, statusMessage: 'Label parsing service returned no result.' })
  }

  return sanitizeLlmFields(responseText)
})
