// Primary parser for bag-label scans: the client posts OCR lines on every
// online scan, and this route asks Gemini to extract the bean fields -
// Gemini's result wins per field over the client's local deterministic parse.
// The app must keep working when this route is unreachable, unconfigured, or
// rate limited - clients degrade silently to the deterministic result.

interface ParseLabelLine {
  text: string
  confidence: number
}

interface ParseLabelBody {
  lines: ParseLabelLine[]
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
const MAX_FIELD_LENGTH = 80
const MAX_TASTING_NOTES = 5
const MIN_PLAUSIBLE_GRAMS = 50
const MAX_PLAUSIBLE_GRAMS = 5000
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
// Coupled with nuxt.config.ts's nitro.vercel.functions.maxDuration (25s,
// gives this headroom for cold start + our own overhead) and the client's
// POLISH_TIMEOUT_MS in useLabelParse.ts (23s, must stay above this so the
// client doesn't abort before this timeout could even fire).
const UPSTREAM_TIMEOUT_MS = 20_000

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
// total time across all attempts still respects UPSTREAM_TIMEOUT_MS no
// matter how many retries happen - each attempt gets whatever time remains,
// not a fresh timeout of its own.
async function fetchGeminiWithRetry(url: string, apiKey: string, requestBody: Record<string, unknown>): Promise<GeminiGenerateContentResponse> {
  const deadline = Date.now() + UPSTREAM_TIMEOUT_MS

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

function isValidBody(body: unknown): body is ParseLabelBody {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as ParseLabelBody).lines)) {
    return false
  }

  const lines = (body as ParseLabelBody).lines

  if (lines.length === 0 || lines.length > MAX_LINES) {
    return false
  }

  let totalTextLength = 0

  for (const line of lines) {
    if (typeof line !== 'object' || line === null) {
      return false
    }

    if (typeof line.text !== 'string' || !Number.isFinite(line.confidence)) {
      return false
    }

    totalTextLength += line.text.length
  }

  return totalTextLength <= MAX_TOTAL_TEXT_LENGTH
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
    const notes = raw.tastingNotes
      .filter((note): note is string => typeof note === 'string')
      .map((note) => note.trim().toLowerCase().slice(0, MAX_FIELD_LENGTH))
      .filter((note) => note.length > 0)
      .slice(0, MAX_TASTING_NOTES)

    if (notes.length > 0) {
      fields.tastingNotes = notes
    }
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
      roastDate: nullableString,
      tastingNotes: { type: 'ARRAY', items: { type: 'STRING' } }
    }
  }
}

const EXTRACTION_INSTRUCTION = [
  'You extract structured fields from OCR text lines read off a coffee bag label.',
  'Return only JSON matching the response schema. Use null for anything not present on the label.',
  'Fields: name (the coffee/product name), roaster (the company), origin (producing country),',
  'region, varietal, process (e.g. Washed, Natural, Honey, Anaerobic),',
  'roastProfile (one of light, light-medium, medium, medium-dark, dark),',
  'startWeight (net bag weight converted to grams, as a number),',
  'roastDate (the roast date as YYYY-MM-DD; never a best-before or expiry date),',
  'tastingNotes (up to 5 short flavor descriptors).',
  'The OCR text may contain recognition errors; infer the intended words.',
  'Each line is followed by its OCR confidence between 0 and 1.'
].join(' ')

export default defineEventHandler(async (event) => {
  const clientKey = getRequestIP(event, { xForwardedFor: true }) ?? 'unknown'

  if (isRateLimited(clientKey)) {
    throw createError({ statusCode: 429, statusMessage: 'Too many scan requests. Try again later.' })
  }

  const body = await readBody(event).catch(() => null)

  if (!isValidBody(body)) {
    throw createError({ statusCode: 400, statusMessage: 'Expected { lines: { text, confidence }[] } within size limits.' })
  }

  const apiKey = process.env.GEMINI_API_KEY

  if (!apiKey) {
    throw createError({ statusCode: 503, statusMessage: 'Label parsing service is not configured.' })
  }

  // Use the rolling alias rather than a dated model id - Google deprecates
  // dated flash versions on its own schedule, and a stale id 404s here.
  const model = process.env.GEMINI_MODEL ?? 'gemini-flash-latest'
  const linesText = body.lines
    .map((line) => `${line.text} [${line.confidence.toFixed(2)}]`)
    .join('\n')

  let responseText: string | undefined

  try {
    const response = await fetchGeminiWithRetry(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      apiKey,
      {
        contents: [
          {
            role: 'user',
            parts: [{ text: `${EXTRACTION_INSTRUCTION}\n\nOCR lines:\n${linesText}` }]
          }
        ],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: buildResponseSchema()
        }
      }
    )

    responseText = response.candidates?.[0]?.content?.parts?.[0]?.text
  }
  catch (error) {
    // Never log the OCR contents or the provider response body.
    const statusCode = (error as { statusCode?: number })?.statusCode
    console.error(`parse-label: provider request failed (status ${statusCode ?? 'unknown'})`)
    throw createError({ statusCode: 502, statusMessage: 'Label parsing service is unavailable.' })
  }

  if (!responseText) {
    throw createError({ statusCode: 502, statusMessage: 'Label parsing service returned no result.' })
  }

  return sanitizeLlmFields(responseText)
})
