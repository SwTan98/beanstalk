import {
  LABEL_PARSE_CONFIDENCE_THRESHOLD,
  parseBeanLabel,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { mergeLabelParse } from '~/utils/label-merge'
import type { OcrLine } from '~/utils/ocr-engine'

export type LabelParseSource = 'deterministic' | 'blended' | 'offline-basic'

const POLISH_TIMEOUT_MS = 6000

// Two-layer label parse: the deterministic parser always runs; when it scores
// below the confidence threshold and the client is online, the OCR lines are
// posted to the optional /api/parse-label polish endpoint. Every failure mode
// (offline, timeout, 4xx/5xx, static build without server routes) degrades
// silently to the local result - scanning never depends on the network.
export async function parseLabelSmart(lines: OcrLine[]): Promise<{ result: LabelParseResult; source: LabelParseSource }> {
  const base = parseBeanLabel(lines)

  if (base.confidence >= LABEL_PARSE_CONFIDENCE_THRESHOLD) {
    return { result: base, source: 'deterministic' }
  }

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

    return { result: mergeLabelParse(base, llm), source: 'blended' }
  }
  catch {
    return { result: base, source: 'deterministic' }
  }
}
