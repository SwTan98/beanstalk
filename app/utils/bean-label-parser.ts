import { roundToSingleDecimal } from '~/utils/domain'
import type { RoastProfile } from '~/utils/types'

export interface ParsedBeanFields {
  name: string | null
  roaster: string | null
  origin: string | null
  region: string | null
  varietal: string | null
  process: string | null
  roastProfile: RoastProfile | null
  startWeight: number | null
}

const WEIGHT_MATCH_ALL_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kgs?|grams?|ounces?|pounds?|lbs?|oz|lb|g|kg)\b/gi
const WEIGHT_LINE_TEST_PATTERN = /(\d+(?:[.,]\d+)?)\s*(kilograms?|kgs?|grams?|ounces?|pounds?|lbs?|oz|lb|g|kg)\b/i
const MIN_PLAUSIBLE_GRAMS = 50
const MAX_PLAUSIBLE_GRAMS = 5000
const NET_WEIGHT_WINDOW = 20
const NET_WEIGHT_KEYWORD_PATTERN = /net\.?\s*(wt|weight)?/i

function unitToGrams(rawUnit: string, amount: number): number {
  const unit = rawUnit.toLowerCase()

  if (unit.startsWith('kilogram') || unit === 'kg' || unit === 'kgs') {
    return amount * 1000
  }

  if (unit.startsWith('ounce') || unit === 'oz') {
    return amount * 28.3495
  }

  if (unit.startsWith('pound') || unit.startsWith('lb')) {
    return amount * 453.592
  }

  return amount
}

function parseWeightGrams(text: string): number | null {
  const candidates: Array<{ grams: number; index: number }> = []

  for (const match of text.matchAll(WEIGHT_MATCH_ALL_PATTERN)) {
    const rawAmount = match[1]
    const rawUnit = match[2]

    if (rawAmount === undefined || rawUnit === undefined) {
      continue
    }

    const amount = Number(rawAmount.replace(',', '.'))

    if (!Number.isFinite(amount)) {
      continue
    }

    const grams = roundToSingleDecimal(unitToGrams(rawUnit, amount))

    if (grams < MIN_PLAUSIBLE_GRAMS || grams > MAX_PLAUSIBLE_GRAMS) {
      continue
    }

    candidates.push({ grams, index: match.index ?? 0 })
  }

  if (candidates.length === 0) {
    return null
  }

  const nearNetWeight = candidates.find(({ index }) => {
    const windowStart = Math.max(0, index - NET_WEIGHT_WINDOW)
    return NET_WEIGHT_KEYWORD_PATTERN.test(text.slice(windowStart, index))
  })

  if (nearNetWeight) {
    return nearNetWeight.grams
  }

  return candidates.reduce((largest, candidate) => (candidate.grams > largest.grams ? candidate : largest)).grams
}

const ROAST_PROFILE_PATTERNS: Array<{ pattern: RegExp; profile: RoastProfile }> = [
  { pattern: /\blight[\s-]?medium\b|\bmedium[\s-]?light\b/i, profile: 'light-medium' },
  { pattern: /\bmedium[\s-]?dark\b/i, profile: 'medium-dark' },
  { pattern: /\bfull\s*city\+?\b/i, profile: 'medium-dark' },
  { pattern: /\bfrench\s*roast\b|\bitalian\s*roast\b|\bvienna\s*roast\b/i, profile: 'dark' },
  { pattern: /\bblonde\b|\bcinnamon\s*roast\b/i, profile: 'light' },
  { pattern: /\bcity\+?\s*roast\b/i, profile: 'medium' },
  { pattern: /\blight\s*roast\b|\blightly\s*roasted\b/i, profile: 'light' },
  { pattern: /\bdark\s*roast\b|\bdarkly\s*roasted\b/i, profile: 'dark' },
  { pattern: /\bmedium\s*roast\b/i, profile: 'medium' },
  { pattern: /\blight\b/i, profile: 'light' },
  { pattern: /\bmedium\b/i, profile: 'medium' },
  { pattern: /\bdark\b/i, profile: 'dark' }
]

function parseRoastProfile(text: string): RoastProfile | null {
  for (const { pattern, profile } of ROAST_PROFILE_PATTERNS) {
    if (pattern.test(text)) {
      return profile
    }
  }

  return null
}

const PROCESS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\banaerobic\s*natural\b/i, label: 'Anaerobic Natural' },
  { pattern: /\banaerobic\s*honey\b/i, label: 'Anaerobic Honey' },
  { pattern: /\banaerobic\s*washed\b/i, label: 'Anaerobic Washed' },
  { pattern: /\bcarbonic\s*maceration\b/i, label: 'Carbonic Maceration' },
  { pattern: /\banaerobic\b/i, label: 'Anaerobic' },
  { pattern: /\bwet[\s-]?hulled\b|\bgiling\s*basah\b/i, label: 'Wet Hulled' },
  { pattern: /\bpulped\s*natural\b/i, label: 'Pulped Natural' },
  { pattern: /\bsemi[\s-]?washed\b/i, label: 'Semi-washed' },
  { pattern: /\bfully\s*washed\b|\bwet\s*process(?:ed)?\b/i, label: 'Washed' },
  { pattern: /\bblack\s*honey\b/i, label: 'Black Honey' },
  { pattern: /\bred\s*honey\b/i, label: 'Red Honey' },
  { pattern: /\byellow\s*honey\b/i, label: 'Yellow Honey' },
  { pattern: /\bwhite\s*honey\b/i, label: 'White Honey' },
  { pattern: /\bhoney\s*process(?:ed)?\b|\bhoney\b/i, label: 'Honey' },
  { pattern: /\bwashed\b/i, label: 'Washed' },
  { pattern: /\bsun[\s-]?dried\b|\bdry\s*process(?:ed)?\b|\bnatural\b/i, label: 'Natural' }
]

function parseProcess(text: string): string | null {
  for (const { pattern, label } of PROCESS_PATTERNS) {
    if (pattern.test(text)) {
      return label
    }
  }

  return null
}

const VARIETAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /\bmundo\s*novo\b/i, label: 'Mundo Novo' },
  { pattern: /\bvilla\s*sarchi\b/i, label: 'Villa Sarchi' },
  { pattern: /\bruiru\s*11\b/i, label: 'Ruiru 11' },
  { pattern: /\bmaragogype\b/i, label: 'Maragogype' },
  { pattern: /\bpacamara\b/i, label: 'Pacamara' },
  { pattern: /\bcatimor\b/i, label: 'Catimor' },
  { pattern: /\bcatua[íi]?\b/i, label: 'Catuai' },
  { pattern: /\bcastillo\b/i, label: 'Castillo' },
  { pattern: /\btypica\b/i, label: 'Typica' },
  { pattern: /\bgeisha\b|\bgesha\b/i, label: 'Geisha' },
  { pattern: /\bcaturra\b/i, label: 'Caturra' },
  { pattern: /\bheirloom\b/i, label: 'Heirloom' },
  { pattern: /\bbourbon\b/i, label: 'Bourbon' },
  { pattern: /\bbatian\b/i, label: 'Batian' },
  { pattern: /\bpache\b/i, label: 'Pache' },
  { pattern: /\bsl[\s-]?28\b/i, label: 'SL28' },
  { pattern: /\bsl[\s-]?34\b/i, label: 'SL34' }
]

function parseVarietal(text: string): string | null {
  for (const { pattern, label } of VARIETAL_PATTERNS) {
    if (pattern.test(text)) {
      return label
    }
  }

  return null
}

const COFFEE_ORIGINS = [
  'Ethiopia', 'Kenya', 'Colombia', 'Brazil', 'Guatemala', 'Costa Rica', 'Honduras',
  'El Salvador', 'Panama', 'Peru', 'Bolivia', 'Rwanda', 'Burundi', 'Uganda', 'Tanzania',
  'Indonesia', 'Sumatra', 'Sulawesi', 'Papua New Guinea', 'India', 'Vietnam',
  'Mexico', 'Nicaragua', 'Ecuador', 'Dominican Republic', 'Yemen', 'China', 'Yunnan',
  'Timor-Leste', 'Hawaii', 'Kona', 'Malawi', 'Zambia', 'Jamaica'
]

function originPattern(origin: string) {
  return new RegExp(`\\b${origin}\\b`, 'i')
}

function isPlausibleRegion(candidate: string) {
  return candidate.length > 0 && candidate.length <= 30 && !/\d/.test(candidate)
}

function parseOriginAndRegion(lines: string[]): { origin: string | null; region: string | null } {
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex]

    if (line === undefined) {
      continue
    }

    for (const origin of COFFEE_ORIGINS) {
      const match = originPattern(origin).exec(line)

      if (!match) {
        continue
      }

      const remainder = line
        .slice(match.index + match[0].length)
        .replace(/^[\s,.\-–:]+/, '')
        .trim()

      let region = remainder.split(/[,;]/)[0]?.trim() || null

      if (!region) {
        const nextLine = lines[lineIndex + 1]?.trim()

        if (nextLine && isPlausibleRegion(nextLine)) {
          region = nextLine
        }
      }

      if (region && !isPlausibleRegion(region)) {
        region = null
      }

      return { origin, region }
    }
  }

  return { origin: null, region: null }
}

const DATE_LIKE_PATTERN = /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b|\bbest\s*by\b|\broasted\s*on\b|\bsell\s*by\b|\buse\s*by\b|\bexp(?:iry|ires)?\b/i
const PURE_ATTRIBUTE_REMAINDER_LIMIT = 3

// A line is only excluded from name/roaster candidacy by an attribute match (roast/process/
// varietal/origin) when the match consumes nearly the whole line - e.g. "Medium Roast" alone.
// Real bag labels frequently fold the origin into the actual product name (e.g. "Ethiopia Worka
// Chelbesa"), so a bare substring match must not disqualify an otherwise-descriptive line.
function isPureAttributeLine(line: string, pattern: RegExp) {
  const match = pattern.exec(line)

  if (!match) {
    return false
  }

  const remainder = line.replace(match[0], '').replace(/^[\s,.\-–:]+|[\s,.\-–:]+$/g, '')
  return remainder.length <= PURE_ATTRIBUTE_REMAINDER_LIMIT
}

function isConsumedLine(line: string) {
  if (WEIGHT_LINE_TEST_PATTERN.test(line) || DATE_LIKE_PATTERN.test(line)) {
    return true
  }

  return (
    ROAST_PROFILE_PATTERNS.some(({ pattern }) => isPureAttributeLine(line, pattern))
    || PROCESS_PATTERNS.some(({ pattern }) => isPureAttributeLine(line, pattern))
    || VARIETAL_PATTERNS.some(({ pattern }) => isPureAttributeLine(line, pattern))
    || COFFEE_ORIGINS.some((origin) => isPureAttributeLine(line, originPattern(origin)))
  )
}

function parseNameAndRoaster(lines: string[]): { name: string | null; roaster: string | null } {
  const leftoverLines = lines.filter((line) => line.length >= 3 && !isConsumedLine(line))

  return {
    roaster: leftoverLines[0] ?? null,
    name: leftoverLines[1] ?? null
  }
}

export function parseBeanLabelText(rawOcrText: string): ParsedBeanFields {
  const text = rawOcrText ?? ''
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const { origin, region } = parseOriginAndRegion(lines)
  const { name, roaster } = parseNameAndRoaster(lines)

  return {
    name,
    roaster,
    origin,
    region,
    varietal: parseVarietal(text),
    process: parseProcess(text),
    roastProfile: parseRoastProfile(text),
    startWeight: parseWeightGrams(text)
  }
}
