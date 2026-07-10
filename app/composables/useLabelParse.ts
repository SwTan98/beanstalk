import {
  parseBeanLabel,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { mergeLabelParse } from '~/utils/label-merge'
import type { OcrLine } from '~/utils/ocr-engine'
import { GEMINI_CLIENT_TIMEOUT_MS } from '#shared/utils/timeouts'

// 'gemini': the polish call succeeded and its fields were merged in as
// primary. 'deterministic': online, but the Gemini call failed, errored, or
// was rate-limited - the local parse alone is what's shown. 'offline-basic':
// the device was offline, so the call was never attempted.
export type LabelParseSource = 'gemini' | 'deterministic' | 'offline-basic'

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
