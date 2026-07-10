import {
  isPlausibleRoastDate,
  LABEL_FIELD_KEYS,
  MAX_TASTING_NOTES,
  type LabelParseResult,
  type ParsedBeanFields
} from '~/utils/bean-label-parser'
import { normalizeTastingNotes } from '~/utils/domain'
import type { RoastProfile } from '~/utils/types'

const ROAST_PROFILE_VALUES: readonly RoastProfile[] = ['light', 'light-medium', 'medium', 'medium-dark', 'dark']
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

// Blends the optional LLM polish into the deterministic parse. The local
// result is the base and the LLM only fills gaps, with two deliberate rules:
// tasting notes are the one field where non-empty LLM output replaces the
// heuristic pick (the sweep is the noisiest extractor), while startWeight and
// roastDate are never overridden - a regex-extracted weight or date read off
// the label beats a model's guess. confidence/matchedFields keep describing
// the local parse; the fallback decision they drive has already been made.
export function mergeLabelParse(base: LabelParseResult, llm: Partial<ParsedBeanFields>): LabelParseResult {
  const merged: LabelParseResult = {
    ...base,
    tastingNotes: [...base.tastingNotes],
    matchedFields: [...base.matchedFields]
  }

  for (const key of LABEL_FIELD_KEYS) {
    switch (key) {
      case 'tastingNotes': {
        const llmNotes = normalizeTastingNotes(llm.tastingNotes ?? []).slice(0, MAX_TASTING_NOTES)

        if (llmNotes.length > 0) {
          merged.tastingNotes = llmNotes
        }

        break
      }
      case 'startWeight':
        // Fill-if-empty only: deterministic weight always wins.
        if (merged.startWeight === null && typeof llm.startWeight === 'number'
          && Number.isFinite(llm.startWeight) && llm.startWeight > 0) {
          merged.startWeight = llm.startWeight
        }

        break
      case 'roastDate':
        // Fill-if-empty only, re-validated: deterministic date always wins.
        if (merged.roastDate === null && typeof llm.roastDate === 'string'
          && ISO_DATE_PATTERN.test(llm.roastDate) && isPlausibleRoastDate(llm.roastDate)) {
          merged.roastDate = llm.roastDate
        }

        break
      case 'roastProfile':
        if (merged.roastProfile === null && typeof llm.roastProfile === 'string'
          && ROAST_PROFILE_VALUES.includes(llm.roastProfile)) {
          merged.roastProfile = llm.roastProfile
        }

        break
      default: {
        const value = llm[key]

        if (merged[key] === null && typeof value === 'string' && value.trim()) {
          merged[key] = value.trim()
        }
      }
    }
  }

  return merged
}
