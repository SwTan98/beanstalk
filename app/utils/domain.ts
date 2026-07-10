import type { Bean, Brew, BrewMethod, DialingInTip, RoastProfile } from '~/utils/types'

export const DEFAULT_BEAN_THRESHOLD = 30

export const ROAST_PROFILES: Array<{ label: string; value: RoastProfile }> = [
  { label: 'Light', value: 'light' },
  { label: 'Light-medium', value: 'light-medium' },
  { label: 'Medium', value: 'medium' },
  { label: 'Medium-dark', value: 'medium-dark' },
  { label: 'Dark', value: 'dark' }
]

export const BREW_METHODS: Array<{ label: string; value: BrewMethod }> = [
  { label: 'V60', value: 'v60' },
  { label: 'Espresso', value: 'espresso' },
  { label: 'AeroPress', value: 'aeropress' },
  { label: 'French press', value: 'french-press' },
  { label: 'Kalita', value: 'kalita' },
  { label: 'Other', value: 'other' }
]

export function createId(prefix: string) {
  const randomId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
  return `${prefix}-${randomId}`
}

export function roundToSingleDecimal(value: number) {
  return Math.round(value * 10) / 10
}

export function calculateRatio(dose: number, yieldAmount: number) {
  return roundToSingleDecimal(yieldAmount / dose)
}

export function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  return String(value).trim()
}

export function normalizeNote(value: unknown) {
  return normalizeText(value).toLowerCase()
}

export function normalizeTastingNotes(notes: unknown[]) {
  const normalized = new Set<string>()

  for (const note of notes) {
    const value = normalizeNote(note)

    if (value) {
      normalized.add(value)
    }
  }

  return Array.from(normalized)
}

export function noteToDisplayLabel(note: string) {
  return note
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ')
}

export function valueToDisplayLabel(value: string) {
  return noteToDisplayLabel(value)
}

export function formatWeight(value: number) {
  return `${roundToSingleDecimal(value)}g`
}

export function formatRatio(value: number) {
  return `1:${value.toFixed(1)}`
}

export function formatDuration(value: number) {
  const totalSeconds = Math.max(0, Math.round(value))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60

  if (minutes === 0) {
    return `${seconds}s`
  }

  return `${minutes}m ${seconds.toString().padStart(2, '0')}s`
}

export function parseDurationSeconds(value: unknown) {
  if (typeof value === 'number') {
    return value
  }

  if (value === null || value === undefined) {
    return 0
  }

  const trimmed = String(value).trim()

  if (!trimmed) {
    return 0
  }

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  const [minutes, seconds] = trimmed.split(':')

  if (seconds === undefined) {
    return Number(trimmed)
  }

  return Number(minutes) * 60 + Number(seconds)
}

export function formatDate(value: string) {
  // Date-only ISO strings ("YYYY-MM-DD") parse as UTC midnight per spec, then
  // Intl.DateTimeFormat renders in the local timezone - for any zone west of
  // UTC that reads back as the previous day. Build the Date from local
  // components instead so the calendar date never shifts.
  const [year, month, day] = value.split('-').map(Number)

  if (year === undefined || month === undefined || day === undefined) {
    return value
  }

  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium'
  }).format(new Date(year, month - 1, day))
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value))
}

export function toDateTimeLocalInput(value: string) {
  const date = new Date(value)
  const offset = date.getTimezoneOffset()
  const localDate = new Date(date.getTime() - offset * 60_000)
  return localDate.toISOString().slice(0, 16)
}

export function fromDateTimeLocalInput(value: string) {
  return new Date(value).toISOString()
}

export function isBeanLowStock(bean: Bean) {
  return bean.archivedAt === null && bean.remaining <= bean.threshold
}

export function sortBeans(beans: Bean[]) {
  return [...beans].sort((left, right) => {
    if (left.archivedAt && !right.archivedAt) {
      return 1
    }

    if (!left.archivedAt && right.archivedAt) {
      return -1
    }

    const leftDate = left.archivedAt ?? left.updatedAt
    const rightDate = right.archivedAt ?? right.updatedAt
    return rightDate.localeCompare(leftDate)
  })
}

export function sortBrews(brews: Brew[]) {
  return [...brews].sort((left, right) => right.brewedAt.localeCompare(left.brewedAt))
}

const UNDER_EXTRACTED_NOTES = new Set(['sour', 'sharp', 'salty', 'thin', 'underdeveloped'])
const OVER_EXTRACTED_NOTES = new Set(['bitter', 'dry', 'astringent', 'hollow', 'smoky'])
const LIGHT_BODY_NOTES = new Set(['watery', 'weak', 'flat'])
const HEAVY_BODY_NOTES = new Set(['muddy', 'heavy', 'dense'])

export function getDialingInTip(recentBrew: Brew | null): DialingInTip {
  if (!recentBrew) {
    return {
      title: 'Log a brew to unlock guidance',
      guidance: 'Your most recent tasting notes will drive a simple dialing-in suggestion here.',
      note: null
    }
  }

  for (const note of recentBrew.tastingNotes) {
    if (UNDER_EXTRACTED_NOTES.has(note)) {
      return {
        title: 'Lean a bit finer',
        guidance: 'Your latest notes suggest under-extraction. Try a slightly finer grind or a touch more contact time on the next brew.',
        note
      }
    }

    if (OVER_EXTRACTED_NOTES.has(note)) {
      return {
        title: 'Back off extraction',
        guidance: 'Those notes usually show up when extraction runs high. Try a slightly coarser grind or shorter contact time.',
        note
      }
    }

    if (LIGHT_BODY_NOTES.has(note)) {
      return {
        title: 'Increase strength',
        guidance: 'The cup read a little light. Try nudging the dose up or tightening the yield for the next attempt.',
        note
      }
    }

    if (HEAVY_BODY_NOTES.has(note)) {
      return {
        title: 'Open the cup up',
        guidance: 'The brew looks a bit dense. Try a slightly lower dose or a bit more yield to add clarity.',
        note
      }
    }
  }

  return {
    title: 'Keep one variable steady',
    guidance: 'No strong warning signs showed up in the latest notes. Keep the recipe close and adjust only one variable at a time.',
    note: recentBrew.tastingNotes[0] ?? null
  }
}
