export type RoastProfile = 'light' | 'light-medium' | 'medium' | 'medium-dark' | 'dark'

export interface Bean {
  id: string
  name: string
  roaster: string
  origin: string
  process: string
  roastProfile: RoastProfile
  startWeight: number
  remaining: number
  threshold: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export type BrewMethod = 'v60' | 'espresso' | 'aeropress' | 'french-press' | 'kalita' | 'other'

export interface Brew {
  id: string
  beanId: string
  brewedAt: string
  method: BrewMethod
  grinder: string
  dose: number
  yield: number
  brewTime: number
  pours: string
  tastingNotes: string[]
  ratio: number
  createdAt: string
  updatedAt: string
}

export interface BeanDraft {
  name: string
  roaster: string
  origin: string
  process: string
  roastProfile: RoastProfile
  startWeight: number
  threshold: number
}

export interface BrewDraft {
  beanId: string
  brewedAt: string
  method: BrewMethod
  grinder: string
  dose: number
  yield: number
  brewTime: number
  pours: string
  tastingNotes: string[]
}

export interface TopTastingNote {
  note: string
  count: number
}

export interface DialingInTip {
  title: string
  guidance: string
  note: string | null
}
