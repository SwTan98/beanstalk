import { normalizeTastingNotes, roundToSingleDecimal } from '~/utils/domain'
import type { OcrBox, OcrLine } from '~/utils/ocr-engine'
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
  roastDate: string | null
  tastingNotes: string[]
}

// Every scannable field, for callers that iterate the parse result (form
// prefill marking, merge logic) without touching confidence/matchedFields.
export const LABEL_FIELD_KEYS = [
  'name',
  'roaster',
  'origin',
  'region',
  'varietal',
  'process',
  'roastProfile',
  'startWeight',
  'roastDate',
  'tastingNotes'
] as const

// Core fields drive the confidence score: weight and origin are printed on
// virtually every bag (strong signals the OCR pass worked); the roast date is
// often a stamp/sticker the OCR misses and process is sometimes absent, so
// they weigh less - missing one alone shouldn't force the online fallback,
// but missing both drops below the threshold.
export type LabelCoreField = 'startWeight' | 'roastDate' | 'origin' | 'process'

const CORE_FIELD_WEIGHTS: Record<LabelCoreField, number> = {
  startWeight: 0.3,
  origin: 0.3,
  process: 0.2,
  roastDate: 0.2
}

export interface LabelParseResult extends ParsedBeanFields {
  confidence: number
  matchedFields: LabelCoreField[]
}

// Below this, the scan flow may consult the online polish endpoint.
export const LABEL_PARSE_CONFIDENCE_THRESHOLD = 0.5

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

// --- Roast date ---------------------------------------------------------------

// Matched against the OCR-corrected copy ('roasted' is in the correction
// vocabulary, so "ROASTEO ON" still hits).
const ROAST_DATE_KEYWORD_PATTERN = /\broast(?:ed)?\b(?:\s*(?:on|date))?/i
// "RD: 03/05" stamps - uppercase with a separator so "3rd" can't match.
const ROAST_DATE_ABBREVIATION_PATTERN = /\bR\.?D\.?\s*[:.\-]/
// Bags carry other dates; none of these lines may source a roast date.
const NOT_ROAST_DATE_PATTERN = /\bbest\s*b(?:y|efore)\b|\bsell\s*by\b|\buse\s*by\b|\bexp(?:iry|ires)?\.?\b|\bbbe?\b/i

const MONTH_NAME_ALTERNATION = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?'
const NUMERIC_DATE_PATTERN = /\b(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})\b/g
const DAY_MONTH_YEAR_PATTERN = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_NAME_ALTERNATION})\\.?,?\\s+(\\d{2,4})\\b`, 'gi')
const MONTH_DAY_YEAR_PATTERN = new RegExp(`\\b(${MONTH_NAME_ALTERNATION})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{2,4})\\b`, 'gi')
const MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

// A roast date is plausible when it sits in the recent past: within the last
// twelve months, allowing a day of clock skew into the future.
const ROAST_DATE_MAX_AGE_MONTHS = 12
const DAY_IN_MS = 24 * 60 * 60 * 1000

function monthNumberFromName(name: string): number {
  const prefix = name.slice(0, 3).toLowerCase()
  return MONTH_PREFIXES.indexOf(prefix) + 1
}

function expandTwoDigitYear(year: number): number {
  return year < 100 ? 2000 + year : year
}

function toIsoDate(year: number, month: number, day: number): string | null {
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }

  const date = new Date(Date.UTC(year, month - 1, day))

  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null
  }

  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function isPlausibleRoastDate(isoDate: string, now: Date): boolean {
  const timestamp = Date.parse(`${isoDate}T00:00:00Z`)
  const earliest = new Date(now)
  earliest.setUTCMonth(earliest.getUTCMonth() - ROAST_DATE_MAX_AGE_MONTHS)
  return timestamp >= earliest.getTime() && timestamp <= now.getTime() + DAY_IN_MS
}

function extractRoastDate(text: string, now: Date): string | null {
  const candidates: Array<string | null> = []

  for (const match of text.matchAll(NUMERIC_DATE_PATTERN)) {
    const [, rawFirst = '', rawSecond = '', rawThird = ''] = match
    const first = Number(rawFirst)
    const second = Number(rawSecond)
    const third = Number(rawThird)

    if (rawFirst.length === 4) {
      candidates.push(toIsoDate(first, second, third))
      continue
    }

    const year = expandTwoDigitYear(third)
    const dayFirst = toIsoDate(year, second, first)
    const monthFirst = toIsoDate(year, first, second)

    if (first > 12) {
      candidates.push(dayFirst)
    }
    else if (second > 12) {
      candidates.push(monthFirst)
    }
    else {
      // Ambiguous dd/mm vs mm/dd: prefer whichever reading lands in the
      // recent-past window; when both (or neither) do, assume day-first.
      const dayFirstPlausible = dayFirst !== null && isPlausibleRoastDate(dayFirst, now)
      const monthFirstPlausible = monthFirst !== null && isPlausibleRoastDate(monthFirst, now)
      candidates.push(dayFirstPlausible || !monthFirstPlausible ? dayFirst : monthFirst)
    }
  }

  for (const match of text.matchAll(DAY_MONTH_YEAR_PATTERN)) {
    const [, rawDay = '', rawMonth = '', rawYear = ''] = match
    candidates.push(toIsoDate(expandTwoDigitYear(Number(rawYear)), monthNumberFromName(rawMonth), Number(rawDay)))
  }

  for (const match of text.matchAll(MONTH_DAY_YEAR_PATTERN)) {
    const [, rawMonth = '', rawDay = '', rawYear = ''] = match
    candidates.push(toIsoDate(expandTwoDigitYear(Number(rawYear)), monthNumberFromName(rawMonth), Number(rawDay)))
  }

  return candidates.find((candidate): candidate is string =>
    candidate !== null && isPlausibleRoastDate(candidate, now)
  ) ?? null
}

// Runs over all lines (anchored ones included): matchAnchors deliberately
// skips date-like lines, so the roast date needs its own pass.
function parseRoastDate(lines: OcrLine[], now: Date = new Date()): string | null {
  const isExcluded = (text: string) => NOT_ROAST_DATE_PATTERN.test(toMatchText(text))
  const isRoastKeyed = (text: string) =>
    ROAST_DATE_KEYWORD_PATTERN.test(toMatchText(text)) || ROAST_DATE_ABBREVIATION_PATTERN.test(text)

  // Date printed on the keyword line itself ("Roasted on 03/05/2026").
  for (const line of lines) {
    if (!isRoastKeyed(line.text) || isExcluded(line.text)) {
      continue
    }

    const date = extractRoastDate(line.text, now)

    if (date) {
      return date
    }
  }

  // Detached layouts: keyword label with the stamped date beside or below.
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]

    if (!line || !isRoastKeyed(line.text) || isExcluded(line.text)) {
      continue
    }

    const valueIndex = findValueLineBeside(index, lines) ?? findValueLineBelow(index, lines)
    const valueLine = valueIndex !== null ? lines[valueIndex] : undefined

    if (!valueLine || isExcluded(valueLine.text)) {
      continue
    }

    const date = extractRoastDate(valueLine.text, now)

    if (date) {
      return date
    }
  }

  // Fallback: exactly one plausible in-window date anywhere on the label.
  const anywhere = new Set<string>()

  for (const line of lines) {
    if (isExcluded(line.text)) {
      continue
    }

    const date = extractRoastDate(line.text, now)

    if (date) {
      anywhere.add(date)
    }
  }

  return anywhere.size === 1 ? [...anywhere][0] ?? null : null
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
  { pattern: /\banaerobic\s*natural\b|\bnatural\s*anaerobic\b/i, label: 'Anaerobic Natural' },
  { pattern: /\banaerobic\s*honey\b|\bhoney\s*anaerobic\b/i, label: 'Anaerobic Honey' },
  { pattern: /\banaerobic\s*washed\b|\bwashed\s*anaerobic\b/i, label: 'Anaerobic Washed' },
  { pattern: /\bcarbonic\s*maceration\b/i, label: 'Carbonic Maceration' },
  { pattern: /\bthermal\s*shock\b/i, label: 'Thermal Shock' },
  { pattern: /\bkoji\b/i, label: 'Koji' },
  { pattern: /\byeast\b/i, label: 'Yeast Fermented' },
  { pattern: /\blactic\b/i, label: 'Lactic' },
  { pattern: /\bco[\s-]?ferment(?:ed|ation)?\b/i, label: 'Co-fermented' },
  { pattern: /\bdouble\s*ferment(?:ed|ation)?\b/i, label: 'Double Fermented' },
  { pattern: /\bdouble\s*washed\b/i, label: 'Double Washed' },
  { pattern: /\bextended\s*fermentation\b/i, label: 'Extended Fermentation' },
  { pattern: /\bswiss\s*water\b/i, label: 'Swiss Water Decaf' },
  { pattern: /\bsugar\s*cane\s*decaf\b|\bsugarcane\s*decaf\b|\bea\s*decaf\b/i, label: 'Sugarcane Decaf' },
  { pattern: /\bco2\s*decaf\b/i, label: 'CO2 Decaf' },
  { pattern: /\bmonsooned\b|\bmonsoon\s*malabar\b/i, label: 'Monsooned' },
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

// Open-ended fallback: processes keep being invented, but they're almost
// always written as "<something> Process/Fermentation/Ferment" - capture the
// whole phrase when no fixed pattern matched.
// [^\S\n] = same-line whitespace only: the sweep text joins OCR lines with
// newlines, and a phrase must not be stitched together across lines.
const PROCESS_SUFFIX_PATTERN = /(?:^|[\s(])((?:[\w'&-]+[^\S\n]+){0,2}[\w'&-]+[^\S\n]+(?:process(?:ed)?|fermentation|ferment))\b/im
const PROCESS_SUFFIX_STOPWORDS = /\b(?:the|our|your|this|that|a|an|of|and|in|with|during|roasting)\b/i
const MAX_PROCESS_PHRASE_LENGTH = 40

function parseProcess(text: string): string | null {
  for (const { pattern, label } of PROCESS_PATTERNS) {
    if (pattern.test(text)) {
      return label
    }
  }

  const suffixMatch = PROCESS_SUFFIX_PATTERN.exec(text)
  const phrase = suffixMatch?.[1]?.trim()

  if (phrase && phrase.length <= MAX_PROCESS_PHRASE_LENGTH && !PROCESS_SUFFIX_STOPWORDS.test(phrase)) {
    return phrase
  }

  return null
}

// Ordering: multi-word / qualified names before the broader names they
// contain ("Pink Bourbon" before "Bourbon", "Typica Mejorada" before
// "Typica"). "Java" is deliberately absent - as a bare word it's far more
// often the Indonesian origin; the anchored `Variety:` path still accepts it.
const VARIETAL_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  // qualified / multi-word first
  { pattern: /\bpink\s*bourbon\b/i, label: 'Pink Bourbon' },
  { pattern: /\byellow\s*bourbon\b/i, label: 'Yellow Bourbon' },
  { pattern: /\borange\s*bourbon\b/i, label: 'Orange Bourbon' },
  { pattern: /\bred\s*bourbon\b/i, label: 'Red Bourbon' },
  { pattern: /\bstriped\s*bourbon\b/i, label: 'Striped Bourbon' },
  { pattern: /\bbourbon\s*aji\b/i, label: 'Bourbon Aji' },
  { pattern: /\bsudan\s*rume\b|\brume\s*sudan\b/i, label: 'Sudan Rume' },
  { pattern: /\btypica\s*mejorada\b/i, label: 'Typica Mejorada' },
  { pattern: /\bmundo\s*novo\b/i, label: 'Mundo Novo' },
  { pattern: /\bvilla\s*sarchi\b/i, label: 'Villa Sarchi' },
  { pattern: /\bruiru\s*11\b/i, label: 'Ruiru 11' },
  { pattern: /\bselection\s*9\b/i, label: 'Selection 9' },
  { pattern: /\banacaf[eé]\s*14\b/i, label: 'Anacafe 14' },
  { pattern: /\bcenicaf[eé]\s*1\b/i, label: 'Cenicafe 1' },
  { pattern: /\bihcafe\s*90\b/i, label: 'IHCAFE 90' },
  { pattern: /\blini\s*s\b/i, label: 'Lini S' },
  { pattern: /\bwush\s*wush\b/i, label: 'Wush Wush' },
  { pattern: /\btim\s*tim\b/i, label: 'TimTim' },
  { pattern: /\bcolombia\s*variety\b|\bvariedad\s*colombia\b/i, label: 'Colombia' },
  // Latin America
  { pattern: /\bmaragogype\b|\bmaragogipe\b/i, label: 'Maragogype' },
  { pattern: /\bmaracaturra\b/i, label: 'Maracaturra' },
  { pattern: /\bpacamara\b/i, label: 'Pacamara' },
  { pattern: /\bpacas\b/i, label: 'Pacas' },
  { pattern: /\bcatimor\b/i, label: 'Catimor' },
  { pattern: /\bcatua[íi]?\b/i, label: 'Catuai' },
  { pattern: /\bcaturr[oó]n\b/i, label: 'Caturron' },
  { pattern: /\bcaturra\b/i, label: 'Caturra' },
  { pattern: /\bcastillo\b/i, label: 'Castillo' },
  { pattern: /\bsidra\b/i, label: 'Sidra' },
  { pattern: /\bchiroso\b/i, label: 'Chiroso' },
  { pattern: /\bpapayo\b/i, label: 'Papayo' },
  { pattern: /\btabi\b/i, label: 'Tabi' },
  { pattern: /\bombligon\b/i, label: 'Ombligon' },
  { pattern: /\bmarsellesa\b/i, label: 'Marsellesa' },
  { pattern: /\bparainema\b/i, label: 'Parainema' },
  { pattern: /\blempira\b/i, label: 'Lempira' },
  { pattern: /\bobat[aã]\b/i, label: 'Obata' },
  { pattern: /\barara\b/i, label: 'Arara' },
  { pattern: /\btop[aá]zio\b/i, label: 'Topazio' },
  { pattern: /\bicatu\b/i, label: 'Icatu' },
  { pattern: /\bacai[aá]\b/i, label: 'Acaia' },
  { pattern: /\beugenioides\b/i, label: 'Eugenioides' },
  { pattern: /\blaurina\b/i, label: 'Laurina' },
  { pattern: /\bmokka\b/i, label: 'Mokka' },
  { pattern: /\bbernardina\b/i, label: 'Bernardina' },
  { pattern: /\btypica\b/i, label: 'Typica' },
  { pattern: /\bgeisha\b|\bgesha\b/i, label: 'Geisha' },
  { pattern: /\bbourbon\b/i, label: 'Bourbon' },
  { pattern: /\bpache\b/i, label: 'Pache' },
  // Africa / Yemen
  { pattern: /\bheirloom\b/i, label: 'Heirloom' },
  { pattern: /\bbatian\b/i, label: 'Batian' },
  { pattern: /\bk7\b/i, label: 'K7' },
  { pattern: /\bnyasaland\b/i, label: 'Nyasaland' },
  { pattern: /\bmibirizi\b/i, label: 'Mibirizi' },
  { pattern: /\bjackson\b/i, label: 'Jackson' },
  { pattern: /\budaini\b/i, label: 'Udaini' },
  { pattern: /\bja'?adi\b/i, label: 'Jaadi' },
  { pattern: /\btuffahi\b/i, label: 'Tuffahi' },
  { pattern: /\bdega\b/i, label: 'Dega' },
  { pattern: /\bkurume\b/i, label: 'Kurume' },
  { pattern: /\bwolisho\b/i, label: 'Wolisho' },
  // Asia
  { pattern: /\bkent\b/i, label: 'Kent' },
  { pattern: /\bs\s*795\b/i, label: 'S795' },
  { pattern: /\bcauvery\b/i, label: 'Cauvery' },
  { pattern: /\bateng\b/i, label: 'Ateng' },
  { pattern: /\bsigararutang\b/i, label: 'Sigararutang' },
  { pattern: /\bandungsari\b/i, label: 'Andungsari' },
  // Kenyan SL selections (kept for pure-attribute line detection; the
  // capture pattern below finds arbitrary SL numbers)
  { pattern: /\bsl[\s-]?28\b/i, label: 'SL28' },
  { pattern: /\bsl[\s-]?34\b/i, label: 'SL34' }
]

// Open-ended families that can't be enumerated: the matched text itself
// becomes the label.
const VARIETAL_CAPTURE_PATTERNS: RegExp[] = [
  /\b74\d{3}\b/g, // Ethiopian JARC selections (74110, 74112, 74158, ...)
  /\bSL[\s-]?\d{1,3}\b/gi // Kenyan SL selections beyond 28/34
]

// Labels frequently list several varietals ("BATIAN, SL28, SL34") - collect
// every dictionary and capture-pattern hit instead of stopping at the first.
function parseVarietal(text: string): string | null {
  const labels = VARIETAL_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label)

  for (const pattern of VARIETAL_CAPTURE_PATTERNS) {
    for (const match of text.matchAll(pattern)) {
      labels.push(match[0].toUpperCase().replace(/[\s-]/g, ''))
    }
  }

  // Dedupe, and drop labels subsumed by a more specific match ("Bourbon"
  // when "Pink Bourbon" already matched).
  const unique = [...new Set(labels)].filter((label, _, all) =>
    !all.some((other) => other !== label && other.toLowerCase().includes(label.toLowerCase()))
  )

  return unique.length > 0 ? unique.join(', ') : null
}

// Multi-word names and specific names come before contained/broader ones
// ("Papua New Guinea" before "Guinea", "Timor-Leste" before "Timor") - the
// first match in a line wins.
const COFFEE_ORIGINS = [
  'Ethiopia', 'Kenya', 'Colombia', 'Brazil', 'Guatemala', 'Costa Rica', 'Honduras',
  'El Salvador', 'Panama', 'Peru', 'Bolivia', 'Rwanda', 'Burundi', 'Uganda', 'Tanzania',
  'Indonesia', 'Sumatra', 'Sulawesi', 'Papua New Guinea', 'India', 'Vietnam',
  'Mexico', 'Nicaragua', 'Ecuador', 'Dominican Republic', 'Yemen', 'China', 'Yunnan',
  'Timor-Leste', 'Hawaii', 'Kona', 'Malawi', 'Zambia', 'Jamaica',
  'Thailand', 'Myanmar', 'Laos', 'Philippines', 'Taiwan', 'Nepal',
  'DR Congo', 'Congo', 'Mozambique', 'Zimbabwe', 'Cameroon', 'Ivory Coast',
  'Haiti', 'Cuba', 'Puerto Rico', 'Venezuela', 'Paraguay', 'Australia',
  'Saint Helena', 'Galapagos', 'Madagascar', 'Angola', 'Togo', 'Guinea', 'Liberia',
  'Java', 'Bali', 'Flores', 'Timor'
]

function originPattern(origin: string) {
  return new RegExp(`\\b${origin}\\b`, 'i')
}

function isPlausibleRegion(candidate: string) {
  return candidate.length > 0 && candidate.length <= 30 && !/\d/.test(candidate)
}

function parseOriginAndRegion(lines: string[]): { origin: string | null; region: string | null; lineIndex: number | null } {
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

      return { origin, region, lineIndex }
    }
  }

  return { origin: null, region: null, lineIndex: null }
}

// --- OCR-confusion correction for matching -----------------------------------
// The recognizer reliably gets most characters but flips one now and then
// ("Mashed" for Washed, "LIGNT" for LIGHT, "Vazietal" for Varietal), which
// defeats exact dictionary/keyword regexes. Tokens within one edit of a known
// label-vocabulary word are corrected in a matching copy of the text; display
// values always come from the original OCR text.

// Words shorter than five letters are excluded (and short tokens never
// corrected): with one-edit tolerance they collide with real label values,
// e.g. the Kenyan region "Meru" is one edit from the origin "Peru".
const CORRECTION_VOCABULARY = [
  'light', 'medium', 'blonde', 'roast', 'roasted', 'roaster', 'roastery',
  'washed', 'natural', 'honey', 'anaerobic', 'carbonic', 'maceration', 'hulled', 'pulped',
  'origin', 'country', 'region', 'variety', 'varietal', 'process', 'processing', 'method',
  'producer', 'altitude', 'elevation', 'harvest', 'notes', 'tasting',
  'flavor', 'flavour', 'flavors', 'flavours',
  // anchor/process terms only - varietal names are deliberately NOT fuzzed,
  // they look too much like the region/name values fuzzing could corrupt
  'thermal', 'ferment', 'fermented', 'fermentation', 'monsooned', 'sugarcane',
  'cultivar', 'cultivars', 'location', 'sourced',
  ...COFFEE_ORIGINS.flatMap((origin) => origin.toLowerCase().split(/[\s-]+/))
].filter((word) => word.length >= 5)

function withinOneEdit(candidate: string, target: string): boolean {
  if (Math.abs(candidate.length - target.length) > 1) {
    return false
  }

  let indexA = 0
  let indexB = 0
  let edits = 0

  while (indexA < candidate.length && indexB < target.length) {
    if (candidate[indexA] === target[indexB]) {
      indexA++
      indexB++
      continue
    }

    if (++edits > 1) {
      return false
    }

    if (candidate.length > target.length) {
      indexA++
    }
    else if (candidate.length < target.length) {
      indexB++
    }
    else {
      indexA++
      indexB++
    }
  }

  return edits + (candidate.length - indexA) + (target.length - indexB) <= 1
}

function correctTokenForMatching(token: string): string {
  if (token.length < 5) {
    return token
  }

  const lower = token.toLowerCase()

  if (CORRECTION_VOCABULARY.includes(lower)) {
    return token
  }

  const corrected = CORRECTION_VOCABULARY.find((word) => withinOneEdit(lower, word))
  return corrected ?? token
}

function toMatchText(text: string): string {
  return text.replace(/[A-Za-z]{5,}/g, (token) => correctTokenForMatching(token))
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

// --- Pass 1: anchored "Key: value" extraction -------------------------------

type AnchorField =
  | 'origin'
  | 'region'
  | 'varietal'
  | 'process'
  | 'roast'
  | 'roaster'
  | 'notes'
  | 'discard'

// `midlineWithoutColon` marks phrases specific enough to anchor mid-line
// without an explicit colon ("Coffee sourced by ARCHERS"); every other
// keyword needs one there so prose like "our roast philosophy" can't anchor.
const ANCHOR_KEYWORDS: Array<{ pattern: RegExp; field: AnchorField; midlineWithoutColon?: boolean }> = [
  { pattern: /^roasted\s*by\b/i, field: 'roaster', midlineWithoutColon: true },
  { pattern: /^sourced\s*by\b/i, field: 'roaster', midlineWithoutColon: true },
  { pattern: /^roaster\b/i, field: 'roaster' },
  { pattern: /^(?:tasting\s*)?notes?\b|^flavou?rs?\b/i, field: 'notes' },
  { pattern: /^(?:elevation|altitude|harvest|producer|farm)\b/i, field: 'discard' },
  { pattern: /^(?:origin|country)\b/i, field: 'origin' },
  { pattern: /^(?:region|location)\b/i, field: 'region' },
  { pattern: /^(?:variet(?:y|ies|als?)|cultivars?)\b/i, field: 'varietal' },
  { pattern: /^(?:process(?:ing)?(?:\s*method)?|fermentation)\b/i, field: 'process' },
  { pattern: /^roast(?:\s*(?:level|profile|degree))?\b/i, field: 'roast' }
]

const ANCHOR_SEPARATOR_PATTERN = /^[\s:.\-–—|\])}]+/
const BRACKET_NOISE_PATTERN = /[[\]{}()|]/g
const MAX_ANCHORED_VALUE_LENGTH = 40
// Note lists routinely exceed the general anchored-value cap
// ("Blackberry, Lemon Zest, Jasmine, Black Tea").
const MAX_NOTES_VALUE_LENGTH = 120

interface AnchorHit {
  field: AnchorField
  value: string
  consumedIndexes: number[]
  // Text preceding a mid-line anchor ("ALO CHILAKA" in "ALO CHILAKA FARM:
  // CHILAKA VILLAGE") - a name fragment from a two-column label merge that
  // should stay in the running for the title pick.
  titlePrefix?: OcrLine
}

interface AnchorKeywordMatch {
  field: AnchorField
  tokensConsumed: number
  midlineWithoutColon: boolean
}

// Keyword detection runs on a bracket-stripped, OCR-corrected copy of the
// tokens ("[Vazietal]" matches the varietal anchor), while values are always
// sliced from the original tokens so real label values are never "corrected"
// into vocabulary words.
function matchKeywordAt(originalTokens: string[], index: number): AnchorKeywordMatch | null {
  // Two-token phrases first so "Roasted by"/"Tasting notes" beat their prefixes.
  for (const tokenCount of [2, 1]) {
    if (index + tokenCount > originalTokens.length) {
      continue
    }

    const head = toMatchText(originalTokens.slice(index, index + tokenCount).join(' '))
      .replace(BRACKET_NOISE_PATTERN, ' ')
      .replace(/\s+/g, ' ')
      .trim()

    for (const { pattern, field, midlineWithoutColon } of ANCHOR_KEYWORDS) {
      const match = pattern.exec(head)

      if (!match) {
        continue
      }

      // The keyword (plus separators) must consume the whole head, so lines
      // that merely start with the word - e.g. "Regional favourites" - and
      // "Origin Ethiopia" as a two-token head don't match here.
      if (head.slice(match[0].length).replace(ANCHOR_SEPARATOR_PATTERN, '').trim()) {
        continue
      }

      return { field, tokensConsumed: tokenCount, midlineWithoutColon: midlineWithoutColon ?? false }
    }
  }

  return null
}

// A single OCR line can carry several anchors when a multi-column label
// merges ("Producer: Tamiru Tadesse Variety: 74158, 74112"). Every keyword
// claims only the text up to the next keyword, so a discard anchor
// (Producer) can never swallow a sibling field's label or value.
function matchAnchors(lineIndex: number, lines: OcrLine[]): AnchorHit[] {
  const line = lines[lineIndex]

  if (!line || DATE_LIKE_PATTERN.test(line.text)) {
    return []
  }

  const originalTokens = line.text.trim().split(/\s+/)
  const keywordMatches: Array<{ field: AnchorField; start: number; valueStart: number }> = []
  let index = 0

  while (index < originalTokens.length) {
    const keyword = matchKeywordAt(originalTokens, index)

    if (!keyword) {
      index++
      continue
    }

    let valueStart = index + keyword.tokensConsumed
    const lastKeywordToken = originalTokens[valueStart - 1] ?? ''
    const nextToken = originalTokens[valueStart]
    const hasColon = lastKeywordToken.includes(':') || nextToken === ':' || nextToken?.startsWith(':') === true

    if (nextToken === ':') {
      valueStart++
    }

    // Mid-line keywords need an explicit colon (by-phrases excepted) so a
    // bare word inside prose ("our roast philosophy") can't anchor.
    if (index > 0 && !hasColon && !keyword.midlineWithoutColon) {
      index++
      continue
    }

    keywordMatches.push({ field: keyword.field, start: index, valueStart })
    index = valueStart
  }

  if (keywordMatches.length === 0) {
    return []
  }

  const hits: AnchorHit[] = keywordMatches.map((match, matchIndex) => {
    const valueEnd = keywordMatches[matchIndex + 1]?.start ?? originalTokens.length
    const value = originalTokens
      .slice(match.valueStart, valueEnd)
      .join(' ')
      .replace(ANCHOR_SEPARATOR_PATTERN, '')
      .trim()

    return { field: match.field, value, consumedIndexes: [lineIndex] }
  })

  // Text before the first keyword is a name fragment from a column merge
  // ("ALO CHILAKA" in "ALO CHILAKA FARM: ...") - keep it for the title pick.
  const firstMatch = keywordMatches[0]
  const firstHit = hits[0]

  if (firstMatch && firstHit && firstMatch.start > 0) {
    const prefixText = originalTokens.slice(0, firstMatch.start).join(' ')
    const prefixShare = prefixText.length / Math.max(1, line.text.length)
    firstHit.titlePrefix = {
      text: prefixText,
      box: { ...line.box, width: Math.round(line.box.width * prefixShare) },
      confidence: line.confidence
    }
  }

  // Detached-value layouts: only unambiguous when the line holds a single
  // keyword ("Variety:" alone). Prefer the value beside the label (split
  // table row), then the one just below it (stacked label/value).
  const single = hits.length === 1 ? hits[0] : undefined

  if (single && !single.value) {
    const valueIndex = findValueLineBeside(lineIndex, lines) ?? findValueLineBelow(lineIndex, lines)
    const valueLine = valueIndex !== null ? lines[valueIndex] : undefined

    if (valueLine && valueIndex !== null) {
      single.value = valueLine.text.trim()
      single.consumedIndexes = [lineIndex, valueIndex]

      // Values can wrap ("74158, 74112," / "74110") - a trailing comma marks
      // a continuation on the next line of the same column.
      let currentIndex = valueIndex
      const maxValueLength = single.field === 'notes' ? MAX_NOTES_VALUE_LENGTH : MAX_ANCHORED_VALUE_LENGTH

      while (/[,;]$/.test(single.value) && single.value.length < maxValueLength) {
        const nextIndex = findValueLineBelow(currentIndex, lines)

        if (nextIndex === null || single.consumedIndexes.includes(nextIndex)) {
          break
        }

        const nextLine = lines[nextIndex]

        if (!nextLine) {
          break
        }

        single.value = `${single.value} ${nextLine.text.trim()}`
        single.consumedIndexes.push(nextIndex)
        currentIndex = nextIndex
      }
    }
  }

  return hits
}

// Label-beside-value layout ("REGION: | BENSA, SIDAMA" as two segments of
// one table row): the nearest non-anchor line to the right that shares the
// label's row and rough text size.
function findValueLineBeside(lineIndex: number, lines: OcrLine[]): number | null {
  const anchor = lines[lineIndex]

  if (!anchor) {
    return null
  }

  const anchorRight = anchor.box.x + anchor.box.width
  const anchorTop = anchor.box.y
  const anchorBottom = anchor.box.y + anchor.box.height
  let best: { index: number; gap: number } | null = null

  for (let index = 0; index < lines.length; index++) {
    const candidate = lines[index]

    if (index === lineIndex || !candidate) {
      continue
    }

    const gap = candidate.box.x - anchorRight

    if (gap < 0 || gap > anchor.box.height * 10) {
      continue
    }

    const overlap = Math.min(anchorBottom, candidate.box.y + candidate.box.height)
      - Math.max(anchorTop, candidate.box.y)

    if (overlap < Math.min(anchor.box.height, candidate.box.height) * 0.5) {
      continue
    }

    // Table values match their label's text size; a huge display line that
    // happens to share the row is not this label's value.
    const heightRatio = Math.max(anchor.box.height, candidate.box.height)
      / Math.max(1, Math.min(anchor.box.height, candidate.box.height))

    if (heightRatio > 2) {
      continue
    }

    if (matchAnchors(index, lines).length > 0) {
      continue
    }

    if (!best || gap < best.gap) {
      best = { index, gap }
    }
  }

  return best?.index ?? null
}

function findValueLineBelow(lineIndex: number, lines: OcrLine[]): number | null {
  const anchor = lines[lineIndex]

  if (!anchor) {
    return null
  }

  const anchorBottom = anchor.box.y + anchor.box.height
  let best: { index: number; gap: number } | null = null

  for (let index = 0; index < lines.length; index++) {
    const candidate = lines[index]

    if (index === lineIndex || !candidate) {
      continue
    }

    const gap = candidate.box.y - anchorBottom

    if (gap < -anchor.box.height * 0.25 || gap > anchor.box.height * 1.5) {
      continue
    }

    // Must roughly share a column with the label, not sit across the bag.
    const horizontalDistance = Math.abs(candidate.box.x - anchor.box.x)

    if (horizontalDistance > anchor.box.width * 2) {
      continue
    }

    if (matchAnchors(index, lines).length > 0) {
      continue
    }

    if (!best || gap < best.gap) {
      best = { index, gap }
    }
  }

  return best?.index ?? null
}

function applyAnchorHit(hit: AnchorHit, fields: ParsedBeanFields) {
  const value = hit.value.trim()

  if (hit.field === 'discard' || !value) {
    return
  }

  // Notes are handled ahead of the general length cap - their lists run long.
  if (hit.field === 'notes') {
    if (value.length <= MAX_NOTES_VALUE_LENGTH) {
      fields.tastingNotes.push(...splitTastingNotes(value))
    }

    return
  }

  if (value.length > MAX_ANCHORED_VALUE_LENGTH) {
    return
  }

  // Line grouping can merge a neighbouring display word into an anchored
  // value ("SL28, SL34 Lemon Zest") - drop trailing tasting descriptors.
  const trimTrailingDescriptors = (raw: string): string => {
    const tokens = raw.split(/\s+/)

    while (tokens.length > 1) {
      const last = tokens[tokens.length - 1]?.toLowerCase().replace(/[^a-z]/g, '') ?? ''

      if (!last || !TASTING_DESCRIPTORS.has(last)) {
        break
      }

      tokens.pop()
    }

    return tokens.join(' ').replace(/[\s,;]+$/, '')
  }

  // Dictionary lookups run on the corrected copy so one-letter OCR garbles
  // ("Mashed") still match; raw values keep the original text.
  const matchValue = toMatchText(value)

  switch (hit.field) {
    case 'origin': {
      const dictionaryMatch = COFFEE_ORIGINS.find((origin) => originPattern(origin).test(matchValue))
      fields.origin ??= dictionaryMatch ?? (isPlausibleRegion(value) ? value : null)
      break
    }
    case 'region': {
      const region = trimTrailingDescriptors(value)
      fields.region ??= isPlausibleRegion(region) ? region : null
      break
    }
    case 'varietal':
      // Keep the raw value: labels often list several varietals ("SL28, SL34")
      // and the dictionary would truncate to the first match.
      fields.varietal ??= trimTrailingDescriptors(value)
      break
    case 'process':
      fields.process ??= parseProcess(matchValue) ?? value
      break
    case 'roast':
      fields.roastProfile ??= parseRoastProfile(matchValue)
      break
    case 'roaster':
      fields.roaster ??= value
      break
  }
}

// --- Name/roaster from OCR geometry ------------------------------------------

const NAME_SIZE_RATIO = 1.5
const ROASTER_CUE_PATTERN = /\broaster(?:s|y)?\b|\broasting\b|\bcoffee\s*co\.?\b/i
const MAX_DIGIT_FRACTION = 0.3

// Store pages and bags print tasting notes in huge display type ("Blackberry",
// "Lemon Zest"), which would otherwise win the size-based name/roaster pick.
// A line is chrome when every meaningful token is a tasting descriptor.
const TASTING_DESCRIPTORS = new Set([
  'blackberry', 'blueberry', 'raspberry', 'strawberry', 'cherry', 'cranberry', 'currant',
  'peach', 'nectarine', 'apricot', 'citrus', 'lemon', 'lime', 'orange', 'grapefruit',
  'bergamot', 'zest', 'jasmine', 'floral', 'flower', 'rose', 'lavender', 'hibiscus',
  'chocolate', 'cocoa', 'caramel', 'toffee', 'butterscotch', 'vanilla', 'molasses', 'sugar',
  'almond', 'hazelnut', 'walnut', 'nutty', 'tea', 'tropical', 'mango', 'pineapple',
  'papaya', 'lychee', 'melon', 'apple', 'pear', 'grape', 'plum', 'pomegranate', 'fig',
  'passion', 'fruit', 'stone', 'berry', 'winey', 'juicy', 'creamy', 'syrupy', 'sweet',
  'blood', 'black', 'red', 'green', 'white'
])

// Half is enough: two-column labels merge tasting notes with neighbouring
// text ("PLUM, BATIAN,"), so an all-tokens rule misses them.
function isTastingNotesLine(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 3)

  if (tokens.length === 0) {
    return false
  }

  const descriptorCount = tokens.filter((token) => TASTING_DESCRIPTORS.has(token)).length
  return descriptorCount / tokens.length >= 0.5
}

// --- Tasting notes ------------------------------------------------------------

const NOTE_SPLIT_PATTERN = /[,;·•|/]+|\s+&\s+|\s+and\s+/i
const MAX_TASTING_NOTES = 5

function splitTastingNotes(value: string): string[] {
  return value
    .split(NOTE_SPLIT_PATTERN)
    .map((note) => note.replace(/^[\s.\-–:]+|[\s.\-–:]+$/g, ''))
    .filter((note) => note.length >= 3 && !/\d/.test(note))
}

// Unanchored sweep: lines that read as note lists - several separated
// segments, at least two of which carry a known flavor descriptor.
function sweepTastingNotes(texts: string[]): string[] {
  const notes: string[] = []

  for (const text of texts) {
    if (!isTastingNotesLine(text)) {
      continue
    }

    const segments = splitTastingNotes(text)

    if (segments.length < 2) {
      continue
    }

    const descriptorSegments = segments.filter((segment) =>
      segment.toLowerCase().split(/[^a-z]+/).some((token) => TASTING_DESCRIPTORS.has(token))
    )

    if (descriptorSegments.length < 2) {
      continue
    }

    notes.push(...segments)
  }

  return notes
}

// Words that appear alone on packaging as chrome, never as a bean name.
const PACKAGING_WORDS = new Set([
  'open', 'coffee', 'info', 'notes', 'date', 'roast', 'roasted', 'filter', 'espresso',
  'omni', 'seasonal', 'whole', 'bean', 'beans', 'ground', 'net', 'weight', 'batch'
])

function isPackagingChrome(text: string): boolean {
  const tokens = text.toLowerCase().split(/[^a-z]+/).filter((token) => token.length >= 2)
  return tokens.length > 0 && tokens.every((token) => PACKAGING_WORDS.has(token))
}

// Checkbox rows and dividers OCR into symbol runs ("□ □ □") that otherwise
// score huge on width-per-character.
function hasEnoughLetters(text: string): boolean {
  const compact = text.replace(/\s+/g, '')
  const letters = (compact.match(/[a-z]/gi) ?? []).length
  return letters / Math.max(1, compact.length) >= 0.5
}

// Marketing paragraphs ("Founded in 2022, ...") are prose, not titles.
const MAX_TITLE_TOKENS = 8

// Detection boxes flatten the font-size signal (their heights are derived from
// a low-resolution segmentation map), but width-per-character still scales
// with the printed size, so height x char-width separates display text from
// body text far more reliably than height alone.
function textSizeScore(line: OcrLine): number {
  const characterCount = Math.max(1, line.text.replace(/\s/g, '').length)
  return line.box.height * (line.box.width / characterCount)
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0
  }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const lower = sorted[middle - 1]
  const upper = sorted[middle]

  if (sorted.length % 2 === 0 && lower !== undefined && upper !== undefined) {
    return (lower + upper) / 2
  }

  return upper ?? 0
}

function isDigitHeavy(text: string): boolean {
  const digits = text.replace(/[^\d]/g, '').length
  return digits / Math.max(1, text.length) > MAX_DIGIT_FRACTION
}

// True when `candidate` is a same-sized line stacked directly above or below
// the block - the next wrapped line of a multi-line title. Side-by-side text
// on the same row has a strongly negative gap on both sides and never
// qualifies.
const MAX_TITLE_CHAIN_LINES = 3

function isStackedContinuation(block: OcrLine[], candidate: OcrLine): boolean {
  const reference = block[0]

  if (!reference) {
    return false
  }

  const heightRatio = Math.max(candidate.box.height, reference.box.height)
    / Math.max(1, Math.min(candidate.box.height, reference.box.height))

  if (heightRatio > 1.25) {
    return false
  }

  const blockTop = Math.min(...block.map((line) => line.box.y))
  const blockBottom = Math.max(...block.map((line) => line.box.y + line.box.height))
  const gapBelow = candidate.box.y - blockBottom
  const gapAbove = blockTop - (candidate.box.y + candidate.box.height)
  const height = reference.box.height

  return (gapBelow >= -height * 0.5 && gapBelow <= height * 1.5)
    || (gapAbove >= -height * 0.5 && gapAbove <= height * 1.5)
}

// A bracketed group: opener, contents, then a closer or end-of-line (the OCR
// sometimes drops the closing bracket).
const BRACKET_GROUP_PATTERN = /[[({<][^\]})>]*(?:[\]})>]|$)/g

function cleanTitleCandidate(text: string): string {
  let cleaned = text.trim()

  // Bracketed tags ("[FILTER]", "[BLACKBERRY, LEMON ZEST, JASMINE]", grind
  // checkboxes) are packaging chrome, not titles. If real text remains once
  // they're removed, keep only that; if the entire line is bracketed tags,
  // it's either a chrome row (several groups - discard) or a brand wordmark
  // like "{HBR}" (single group - keep its inner text, braces trimmed below).
  const bracketGroups = cleaned.match(BRACKET_GROUP_PATTERN) ?? []
  const outsideBrackets = cleaned.replace(BRACKET_GROUP_PATTERN, ' ').replace(/\s+/g, ' ').trim()

  if (outsideBrackets.length >= 3) {
    cleaned = outsideBrackets
  }
  else if (bracketGroups.length >= 2) {
    return ''
  }

  return cleaned
    .replace(/^[\s,.\-–—:|[\]{}()<>'"„“”]+|[\s,.\-–—:|[\]{}()<>'"„“”]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseNameAndRoaster(candidates: OcrLine[], allLines: OcrLine[]): { name: string | null; roaster: string | null } {
  const usable = candidates
    .map((line) => ({ ...line, text: cleanTitleCandidate(line.text) }))
    .filter((line) =>
      line.text.length >= 3
      && line.text.split(/\s+/).length <= MAX_TITLE_TOKENS
      && !isDigitHeavy(line.text)
      && hasEnoughLetters(line.text)
      && !isTastingNotesLine(line.text)
      && !isPackagingChrome(line.text)
    )

  if (usable.length === 0) {
    return { name: null, roaster: null }
  }

  const medianScore = median(allLines.map(textSizeScore))
  const roasterCued = usable.find((line) => ROASTER_CUE_PATTERN.test(line.text))
  const nameCandidates = usable
    .filter((line) => line !== roasterCued)
    .sort((left, right) => textSizeScore(right) - textSizeScore(left))

  const meetsNameThreshold = (line: OcrLine | undefined): line is OcrLine =>
    line !== undefined && medianScore > 0 && textSizeScore(line) >= medianScore * NAME_SIZE_RATIO

  let name = meetsNameThreshold(nameCandidates[0]) ? nameCandidates[0]!.text : null
  let roaster = roasterCued?.text ?? null

  // A dominant single short token is a brand wordmark ("HBR"), not a bean
  // name - route it to roaster and promote the next display-sized line.
  // Four characters max: real single-word names ('UNIQUE') run longer than
  // acronym logos (HBR, ONA, SEY).
  if (name && !roaster && /^\S{1,4}$/.test(name)) {
    roaster = name
    name = meetsNameThreshold(nameCandidates[1]) ? nameCandidates[1]!.text : null
  }

  if (!roaster) {
    const nameLine = nameCandidates[0]

    if (name && nameLine) {
      // Wrapped titles: chain same-sized lines stacked against the name
      // ("Ethiopia" / "Alo Coffee" / "Mewa Village") before treating the
      // next display-sized line as the roaster.
      const chain = [nameLine]

      while (chain.length < MAX_TITLE_CHAIN_LINES) {
        const next = nameCandidates.find((line) =>
          !chain.includes(line)
          && textSizeScore(line) > medianScore
          && isStackedContinuation(chain, line)
        )

        if (!next) {
          break
        }

        chain.push(next)
      }

      if (chain.length > 1) {
        name = chain
          .sort((left, right) => left.box.y - right.box.y)
          .map((line) => line.text)
          .join(' ')
      }

      roaster = nameCandidates
        .find((line) => !chain.includes(line) && textSizeScore(line) > medianScore)?.text ?? null
    }
    else {
      roaster = nameCandidates.find((line) => line.text !== name && textSizeScore(line) > medianScore)?.text ?? null
    }
  }

  if (!name && !roaster) {
    // No usable size signal - fall back to reading order.
    return {
      roaster: usable[0]?.text ?? null,
      name: usable[1]?.text ?? usable[0]?.text ?? null
    }
  }

  return { name, roaster }
}

// --- Entry point --------------------------------------------------------------

export function parseBeanLabel(ocrLines: OcrLine[]): LabelParseResult {
  const fields: ParsedBeanFields = {
    name: null,
    roaster: null,
    origin: null,
    region: null,
    varietal: null,
    process: null,
    roastProfile: null,
    startWeight: null,
    roastDate: null,
    tastingNotes: []
  }

  const lines = ocrLines.filter((line) => line.text.trim().length > 0)
  const consumed = new Set<number>()
  const prefixTitleLines: OcrLine[] = []

  // Pass 1: anchored "Key: value" lines win over everything else. A line can
  // carry several anchors when a multi-column label row merges.
  for (let index = 0; index < lines.length; index++) {
    if (consumed.has(index)) {
      continue
    }

    for (const hit of matchAnchors(index, lines)) {
      applyAnchorHit(hit, fields)
      hit.consumedIndexes.forEach((consumedIndex) => consumed.add(consumedIndex))

      if (hit.titlePrefix) {
        prefixTitleLines.push(hit.titlePrefix)
      }
    }
  }

  const unconsumedLines = lines.filter((_, index) => !consumed.has(index))
  const unconsumedTexts = unconsumedLines.map((line) => toMatchText(line.text.trim()))
  const fullMatchText = toMatchText(lines.map((line) => line.text).join('\n'))

  // Pass 2: dictionary sweep over whatever pass 1 didn't claim, using the
  // OCR-corrected copy so one-letter garbles still match.
  let originLine: OcrLine | null = null

  if (!fields.origin) {
    const { origin, region, lineIndex } = parseOriginAndRegion(unconsumedTexts)
    fields.origin = origin
    fields.region ??= region
    originLine = lineIndex !== null ? unconsumedLines[lineIndex] ?? null : null
  }

  // Origin-only fallback over all text: anchors may have consumed the line
  // that carried the country ("/ETHIOPIA PRODUCER: ..."). Country names are
  // precise enough to match anywhere; region stays line-based.
  if (!fields.origin) {
    fields.origin = COFFEE_ORIGINS.find((origin) => originPattern(origin).test(fullMatchText)) ?? null
  }

  fields.varietal ??= parseVarietal(fullMatchText)
  fields.process ??= parseProcess(fullMatchText)
  fields.roastProfile ??= parseRoastProfile(fullMatchText)
  fields.startWeight = parseWeightGrams(fullMatchText)
  fields.roastDate = parseRoastDate(lines)

  // Anchored notes (pass 1) come first; the sweep only tops up to the cap.
  fields.tastingNotes.push(...sweepTastingNotes(unconsumedLines.map((line) => line.text.trim())))
  fields.tastingNotes = normalizeTastingNotes(fields.tastingNotes).slice(0, MAX_TASTING_NOTES)

  // Name/roaster from the leftover display text, picked by font size.
  // Prefixes rescued from mid-line anchors compete alongside whole lines.
  const titleCandidates = unconsumedLines
    .concat(prefixTitleLines)
    .filter((line) => !isConsumedLine(toMatchText(line.text.trim())))
  const { name, roaster } = parseNameAndRoaster(titleCandidates, lines)
  fields.name = name
  fields.roaster ??= roaster

  // Minimal labels often use the origin itself as the product name ("KENYA
  // KII"), which isConsumedLine strips from title candidacy - fall back to
  // the origin-matched line when nothing else claimed the name.
  if (!fields.name && originLine) {
    const originTitle = cleanTitleCandidate(originLine.text)

    if (originTitle.length >= 3 && !isDigitHeavy(originTitle) && originTitle !== fields.roaster) {
      fields.name = originTitle

      // Wrapped titles: chain same-sized lines stacked against the origin
      // line ("ETHIOPIA YIRGACHEFFE" / "ARICHA WEBANCHI").
      const chain = [originLine]

      while (chain.length < MAX_TITLE_CHAIN_LINES) {
        const next = lines.find((line) => {
          if (chain.includes(line)) {
            return false
          }

          const text = cleanTitleCandidate(line.text)

          return isStackedContinuation(chain, line)
            && text.length >= 3
            && !isDigitHeavy(text)
            && !isTastingNotesLine(text)
            && !isPackagingChrome(text)
            && !isConsumedLine(toMatchText(text))
        })

        if (!next) {
          break
        }

        chain.push(next)
      }

      if (chain.length > 1) {
        fields.name = chain
          .sort((left, right) => left.box.y - right.box.y)
          .map((line) => cleanTitleCandidate(line.text))
          .join(' ')

        for (const line of chain) {
          if (fields.roaster === cleanTitleCandidate(line.text)) {
            fields.roaster = null
          }
        }
      }
    }
  }

  const matchedFields = (Object.keys(CORE_FIELD_WEIGHTS) as LabelCoreField[])
    .filter((field) => fields[field] !== null)
  const confidence = matchedFields.reduce((total, field) => total + CORE_FIELD_WEIGHTS[field], 0)

  return {
    ...fields,
    confidence: Math.round(confidence * 100) / 100,
    matchedFields
  }
}
