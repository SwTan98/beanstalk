import {
  isPlausibleRoastDate,
  LABEL_FIELD_KEYS,
  MAX_TASTING_NOTES,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { normalizeTastingNotes, ROAST_PROFILES } from '~/utils/domain'
import type { RoastProfile } from '~/utils/types'

const ROAST_PROFILE_VALUES: readonly RoastProfile[] = ROAST_PROFILES.map((profile) => profile.value)
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Blends the Gemini polish into the deterministic parse. Gemini is the
// primary source: a valid value from it wins on every field, and the
// deterministic parse - always computed locally, whether or not Gemini was
// even reachable - is only the fallback for fields Gemini left null/empty or
// returned something implausible for. "Valid" still means the same bar as
// before: startWeight is a finite positive number, roastDate is ISO-shaped
// and in the plausible recent-past window, roastProfile is one of the five
// known values, and tastingNotes/plain-string fields are non-empty after
// normalizing - this is what stops a malformed or hallucinated Gemini
// response from corrupting the result. confidence/matchedFields keep
// describing the deterministic parse alone, independent of this merge.
export function mergeLabelParse(deterministic: LabelParseResult, gemini: Partial<ParsedBeanFields>): LabelParseResult {
  const merged: LabelParseResult = {
    ...deterministic,
    tastingNotes: [...deterministic.tastingNotes],
    matchedFields: [...deterministic.matchedFields]
  }

  for (const key of LABEL_FIELD_KEYS) {
    switch (key) {
      case 'tastingNotes': {
        // A present (even empty) array means Gemini answered - trust it over
        // the noisier local sweep, including an explicit "no notes found".
        // undefined means the field was never returned (network/validation
        // failure upstream), which falls back to the deterministic result.
        merged.tastingNotes = gemini.tastingNotes !== undefined
          ? normalizeTastingNotes(gemini.tastingNotes).slice(0, MAX_TASTING_NOTES)
          : deterministic.tastingNotes
        break
      }
      case 'startWeight':
        merged.startWeight = (typeof gemini.startWeight === 'number'
          && Number.isFinite(gemini.startWeight) && gemini.startWeight > 0)
          ? gemini.startWeight
          : deterministic.startWeight

        break
      case 'roastDate':
        merged.roastDate = (typeof gemini.roastDate === 'string'
          && ISO_DATE_PATTERN.test(gemini.roastDate) && isPlausibleRoastDate(gemini.roastDate))
          ? gemini.roastDate
          : deterministic.roastDate

        break
      case 'roastProfile':
        merged.roastProfile = (typeof gemini.roastProfile === 'string'
          && ROAST_PROFILE_VALUES.includes(gemini.roastProfile))
          ? gemini.roastProfile
          : deterministic.roastProfile

        break
      default: {
        const value = gemini[key]
        merged[key] = (typeof value === 'string' && value.trim()) ? value.trim() : deterministic[key]
      }
    }
  }

  return merged
}
