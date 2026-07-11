import {
  isPlausibleRoastDate,
  MAX_TASTING_NOTES,
  parseBeanLabel,
  type LabelCoreField,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { mergeLabelParse } from '~/utils/label-merge'
import { normalizeTastingNotes, ROAST_PROFILES } from '~/utils/domain'
import type { RoastProfile } from '~/utils/types'
import type { OcrLine } from '~/utils/ocr-engine'
import { GEMINI_CLIENT_TIMEOUT_MS } from '#shared/utils/timeouts'

// 'gemini': the text-mode polish call succeeded and its fields were merged in
// as primary. 'gemini-image': the image-mode call succeeded and its result is
// used wholesale (no merge - OCR never ran). 'deterministic': online, but the
// Gemini call failed, errored, or was rate-limited - the local parse alone is
// what's shown. 'offline-basic': the device was offline, so the call was
// never attempted.
export type LabelParseSource = 'gemini' | 'gemini-image' | 'deterministic' | 'offline-basic'

export interface LabelImagePayload {
  // Raw base64 payload, no data-URL prefix.
  data: string
  mimeType: string
}

const ROAST_PROFILE_VALUES: readonly RoastProfile[] = ROAST_PROFILES.map((profile) => profile.value)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

function sanitizeText(value: unknown): string | null {
  return (typeof value === 'string' && value.trim()) ? value.trim() : null
}

// Builds a standalone result from an image-mode Gemini response, applying the
// same validity bar as mergeLabelParse but with null/[] fallbacks - there is
// no deterministic parse to fall back on because OCR never ran. confidence is
// diagnostic-only (documented in bean-label-parser.ts, no UI reads it): a
// fixed 1 marks "not a degraded local parse" without inventing a fake score.
function toWholesaleResult(llm: Partial<ParsedBeanFields>): LabelParseResult {
  const result: LabelParseResult = {
    name: sanitizeText(llm.name),
    roaster: sanitizeText(llm.roaster),
    origin: sanitizeText(llm.origin),
    region: sanitizeText(llm.region),
    varietal: sanitizeText(llm.varietal),
    process: sanitizeText(llm.process),
    roastProfile: (typeof llm.roastProfile === 'string' && ROAST_PROFILE_VALUES.includes(llm.roastProfile))
      ? llm.roastProfile
      : null,
    startWeight: (typeof llm.startWeight === 'number' && Number.isFinite(llm.startWeight) && llm.startWeight > 0)
      ? llm.startWeight
      : null,
    roastDate: (typeof llm.roastDate === 'string' && ISO_DATE_PATTERN.test(llm.roastDate) && isPlausibleRoastDate(llm.roastDate))
      ? llm.roastDate
      : null,
    tastingNotes: normalizeTastingNotes(llm.tastingNotes ?? []).slice(0, MAX_TASTING_NOTES),
    confidence: 1,
    matchedFields: []
  }

  const coreFields: LabelCoreField[] = ['startWeight', 'roastDate', 'origin', 'process']
  result.matchedFields = coreFields.filter((field) => result[field] !== null)
  return result
}

// Image mode: posts the bag photo itself and uses Gemini's answer wholesale.
// Unlike parseLabelSmart this THROWS on any failure (offline, timeout,
// 4xx/5xx including the flag-off 400, static build) - the caller owns the
// fallback, which is the full OCR + deterministic path, not a merge.
export async function parseLabelFromImage(image: LabelImagePayload): Promise<LabelParseResult> {
  const llm = await $fetch<Partial<ParsedBeanFields>>('/api/parse-label', {
    method: 'POST',
    timeout: GEMINI_CLIENT_TIMEOUT_MS,
    body: { image }
  })

  return toWholesaleResult(llm)
}

// Deterministic-only parse: the fallback for image mode, which never chains a
// second (text-mode) Gemini call - the image attempt may already have burned
// the whole client timeout, and a retry seconds later would hit the same
// overloaded upstream while double-spending the rate limit.
export function parseLabelBasic(lines: OcrLine[]): { result: LabelParseResult; source: LabelParseSource } {
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false
  return { result: parseBeanLabel(lines), source: offline ? 'offline-basic' : 'deterministic' }
}

// The deterministic parser always runs first (it's free/instant) and is the
// fallback result. Gemini is the primary source: every online scan posts the
// OCR lines to /api/parse-label and its response wins per field via
// mergeLabelParse. Every failure mode (offline, timeout, 4xx/5xx, static
// build without server routes) degrades silently to the local result -
// scanning never depends on the network.
export async function parseLabelSmart(lines: OcrLine[]): Promise<{ result: LabelParseResult; source: LabelParseSource }> {
  const base = parseBeanLabel(lines)

  // Only an explicit false means offline - environments without the API
  // (older webviews) should still attempt the polish call.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { result: base, source: 'offline-basic' }
  }

  let llm: Partial<ParsedBeanFields>

  try {
    llm = await $fetch<Partial<ParsedBeanFields>>('/api/parse-label', {
      method: 'POST',
      timeout: GEMINI_CLIENT_TIMEOUT_MS,
      body: { lines: lines.map(({ text, confidence }) => ({ text, confidence })) }
    })
  }
  catch {
    // Expected failure mode (offline, timeout, 4xx/5xx, static build without
    // server routes) - degrade silently, no logging.
    return { result: base, source: 'deterministic' }
  }

  try {
    return { result: mergeLabelParse(base, llm), source: 'gemini' }
  }
  catch (error) {
    // Unexpected: the fetch succeeded but merging failed, which points at a
    // real bug rather than an ordinary network failure - worth surfacing.
    console.error('parseLabelSmart: merge failed', error)
    return { result: base, source: 'deterministic' }
  }
}
