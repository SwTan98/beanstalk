import {
  parseBeanLabel,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { mergeLabelParse } from '~/utils/label-merge'
import type { OcrLine } from '~/utils/ocr-engine'

// 'gemini': the polish call succeeded and its fields were merged in as
// primary. 'deterministic': online, but the Gemini call failed, errored, or
// was rate-limited - the local parse alone is what's shown. 'offline-basic':
// the device was offline, so the call was never attempted.
export type LabelParseSource = 'gemini' | 'deterministic' | 'offline-basic'

// Must stay above server/api/parse-label.post.ts's UPSTREAM_TIMEOUT_MS (20s)
// so this client doesn't abort before the server's own timeout could even
// fire - both are within nuxt.config.ts's 25s Vercel function limit.
const POLISH_TIMEOUT_MS = 23_000

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

  try {
    const llm = await $fetch<Partial<ParsedBeanFields>>('/api/parse-label', {
      method: 'POST',
      timeout: POLISH_TIMEOUT_MS,
      body: { lines: lines.map(({ text, confidence }) => ({ text, confidence })) }
    })

    return { result: mergeLabelParse(base, llm), source: 'gemini' }
  }
  catch {
    return { result: base, source: 'deterministic' }
  }
}
