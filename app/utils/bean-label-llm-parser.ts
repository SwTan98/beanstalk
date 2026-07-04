import type { ParsedBeanFields } from '~/utils/bean-label-parser'
import { ROAST_PROFILES, roundToSingleDecimal } from '~/utils/domain'
import { completeChatJson } from '~/utils/llm-engine'
import type { RoastProfile } from '~/utils/types'

const MIN_PLAUSIBLE_GRAMS = 50
const MAX_PLAUSIBLE_GRAMS = 5000
const MAX_FIELD_LENGTH = 60
const MAX_INPUT_CHARS = 2000

const VALID_ROAST_PROFILES = new Set<string>(ROAST_PROFILES.map(({ value }) => value))

// Grammar-constrained JSON output (WebLLM/XGrammar) doesn't reliably support nullable
// unions, so "unknown" text fields use "" / "unknown" / 0 sentinels instead of null and
// get normalized back to null below - this keeps the schema simple across model backends.
const RESPONSE_SCHEMA = JSON.stringify({
  type: 'object',
  properties: {
    name: { type: 'string' },
    roaster: { type: 'string' },
    origin: { type: 'string' },
    region: { type: 'string' },
    varietal: { type: 'string' },
    process: { type: 'string' },
    roastProfile: { type: 'string', enum: [...VALID_ROAST_PROFILES, 'unknown'] },
    startWeight: { type: 'number' }
  },
  required: ['name', 'roaster', 'origin', 'region', 'varietal', 'process', 'roastProfile', 'startWeight']
})

const SYSTEM_PROMPT = `You extract structured product details from OCR text scanned off a coffee bean bag label. The OCR text is noisy: lines may be out of order, split oddly, or contain scanning artifacts.

Respond with a JSON object with these fields:
- name: the coffee's product name (often origin + an evocative name), not the roaster. "" if unknown.
- roaster: the roasting company's brand name. "" if unknown.
- origin: the producing country, e.g. "Ethiopia". "" if unknown.
- region: the growing region/farm/cooperative within the origin. "" if unknown.
- varietal: the coffee varietal, e.g. "Heirloom", "Bourbon", "Geisha". "" if unknown.
- process: the processing method, e.g. "Washed", "Natural", "Honey". "" if unknown.
- roastProfile: one of "light", "light-medium", "medium", "medium-dark", "dark", or "unknown".
- startWeight: net weight of the bag in GRAMS as a number, converting oz/lb/kg to grams. 0 if unknown.

Do not invent values you cannot support from the text.`

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const trimmed = value.trim()

  if (!trimmed || trimmed.length > MAX_FIELD_LENGTH || trimmed.toLowerCase() === 'unknown') {
    return null
  }

  return trimmed
}

function normalizeRoastProfile(value: unknown): RoastProfile | null {
  return typeof value === 'string' && VALID_ROAST_PROFILES.has(value) ? (value as RoastProfile) : null
}

function normalizeWeight(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null
  }

  const grams = roundToSingleDecimal(value)
  return grams >= MIN_PLAUSIBLE_GRAMS && grams <= MAX_PLAUSIBLE_GRAMS ? grams : null
}

function extractJsonObject(raw: string): Record<string, unknown> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')

  if (start === -1 || end === -1 || end < start) {
    throw new Error('LLM response did not contain a JSON object.')
  }

  return JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>
}

export async function parseBeanLabelWithLlm(
  rawOcrText: string,
  onProgress?: (progress: number) => void
): Promise<ParsedBeanFields> {
  const content = await completeChatJson(
    [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: rawOcrText.slice(0, MAX_INPUT_CHARS) }
    ],
    RESPONSE_SCHEMA,
    onProgress
  )

  const parsed = extractJsonObject(content)

  return {
    name: normalizeText(parsed.name),
    roaster: normalizeText(parsed.roaster),
    origin: normalizeText(parsed.origin),
    region: normalizeText(parsed.region),
    varietal: normalizeText(parsed.varietal),
    process: normalizeText(parsed.process),
    roastProfile: normalizeRoastProfile(parsed.roastProfile),
    startWeight: normalizeWeight(parsed.startWeight)
  }
}
