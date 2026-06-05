# BeanStalk MVP Implementation Plan

This document is the implementation plan for the first shippable version of **BeanStalk**: an **offline-first Nuxt app** for managing a bean stash, logging brews, and surfacing simple insights. It is intentionally narrower than the broader product ideas. For MVP, the focus is a reliable single-device experience with local persistence, clear business rules, and static deployment readiness.

## 1. MVP Scope

### In scope

- **Stash management:** create, view, archive, and monitor beans
- **Brew journal:** log brews against beans with validation and automatic stash deduction
- **Insights:** low-stock alerts, top tasting notes, and a small rule-based dialing-in helper
- **Offline-first behavior:** app remains usable without a network connection
- **Installable PWA:** manifest, service worker, and mobile-friendly UI

### Out of scope for MVP

- Cloud sync, Supabase, multi-device sync, account systems, or conflict resolution
- Payments, monetization, premium unlocks, affiliate links, or donations
- Advanced analytics, charts, exports, sharing, or collaboration
- Complex recommendation engines or AI-assisted tasting analysis

## 2. Core Technical Decisions

- **Framework:** Nuxt 3 / Vue 3, using the existing repo scaffold
- **Source structure:** build inside `app/`, especially `app/pages`, `app/components`, `app/composables`, and `app/utils`
- **Styling:** Tailwind CSS
- **Icons:** `@lucide/vue-next`
- **PWA:** `@vite-pwa/nuxt`
- **Persistence:** **IndexedDB via `idb`**
  - Choose `idb` over Dexie for MVP to keep the storage layer small and explicit
  - Do not use localStorage as the primary database
- **State management:** **Nuxt `useState()` plus composables**
  - Keep business logic in composables and storage helpers
  - Do not introduce Pinia unless the app later grows beyond this shape
- **Deployment target:** **static generation** via `pnpm generate`
  - `pnpm build` remains useful for framework validation, but MVP hosting should assume static deployment

## 3. Architecture

The MVP should be organized into four layers:

1. **Pages and components** in `app/` collect input and render state
2. **Domain/state composables** own mutations, derived values, and validation
3. **Storage helpers** wrap IndexedDB reads and writes
4. **PWA configuration** handles manifest, icons, caching, and installability

UI components must not directly mutate persistence records in ad hoc ways. Bean remaining weight, brew validation, archive behavior, and insight derivation should all flow through shared domain logic.

## 4. Data Model

Define two primary entities and keep them strongly typed.

### Bean

```ts
type RoastProfile = 'light' | 'light-medium' | 'medium' | 'medium-dark' | 'dark'

interface Bean {
  id: string
  name: string
  roaster: string
  origin: string
  region: string
  varietal: string
  process: string
  roastProfile: RoastProfile
  startWeight: number
  remaining: number
  threshold: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
```

### Brew

```ts
type BrewMethod = 'v60' | 'espresso' | 'aeropress' | 'french-press' | 'kalita' | 'other'

interface Brew {
  id: string
  beanId: string
  brewedAt: string
  method: BrewMethod
  grinder: string
  dose: number
  yield: number
  brewTime: string
  pours: string
  tastingNotes: string[]
  ratio: number
  createdAt: string
  updatedAt: string
}
```

### Domain defaults

- **Bean threshold default:** `30`
- **Region** should store the growing area as a human-readable string, such as `Guji`, `Sidamo`, or `Huehuetenango`
- **Varietal** should store the cultivar or blend descriptor, such as `Heirloom`, `Bourbon`, or `Caturra`
- **Remaining** is stored, not only derived, so list screens remain cheap to render offline
- **Ratio** is stored at save time as `yield / dose`, while also being easy to recompute in forms
- **Archived beans** remain available for historical brew references but cannot be selected for new brews

## 5. Business Rules

These rules should be centralized in composables or domain helpers, not spread across components.

### Bean rules

- `startWeight` must be greater than `0`
- `threshold` must be `>= 0` and should default to `30`
- `region` and `varietal` must be non-empty strings
- `remaining` must stay between `0` and `startWeight`
- Archiving a bean sets `archivedAt`; it does not delete the bean or its brew history

### Brew rules

- `beanId` must reference an existing non-archived bean
- `dose` must be greater than `0`
- `yield` must be greater than `0`
- `dose` cannot exceed the selected bean’s current `remaining`
- Saving a brew deducts `dose` from the bean’s `remaining`
- Editing a brew must first restore the previous dose to the bean, then apply the new dose
- Deleting a brew must restore its `dose` to the related bean

### Tasting note rules

- Normalize custom notes by trimming whitespace and lowercasing for storage
- Preserve a display label in UI by title-casing normalized values
- Prevent empty notes and duplicate notes within the same brew entry

### Empty and edge states

- If there are no beans, stash shows an empty state and journal blocks new brew creation with guidance
- If all beans are archived or empty, journal shows no selectable beans
- If a bean reaches `0g`, it remains visible and may be archived from stash
- Historical brews must continue rendering even if the linked bean is archived

## 6. Persistence Plan

Use IndexedDB with two object stores:

- `beans`
- `brews`

Create a small storage API such as:

- `listBeans()`
- `saveBean(bean)`
- `getBean(id)`
- `listBrews()`
- `saveBrew(brew)`
- `deleteBrew(id)`

All writes should be explicit and awaited. App startup should hydrate beans and brews from IndexedDB into shared state. Mutations should update in-memory state and persistence together through the same domain layer.

## 7. PWA Plan

Configure `@vite-pwa/nuxt` with explicit MVP defaults:

- App name: **BeanStalk**
- Short name: **BeanStalk**
- Theme color: coffee-toned dark brown
- Background color: warm off-white
- Display mode: `standalone`
- Icons: at minimum 192x192 and 512x512

Service worker behavior for MVP:

- Precache app shell assets
- Cache generated static pages and icons
- Do not attempt background sync or remote API caching
- Show the locally persisted app state even when offline

An explicit offline HTML fallback is optional, but the generated app shell and IndexedDB-backed data flow must still allow the main UI to load after install.

## 8. UI Surfaces

### Stash

- Route: `/stash`
- Shows active beans first, archived beans second
- Provides a primary action to add a bean
- Displays bean cards with name, roaster, origin, region, varietal, process, roast profile, remaining, and threshold state
- Surfaces low-stock beans prominently when `remaining <= threshold`

### New bean

- Route: `/stash/new`
- Collects bean details with mobile-friendly form controls
- Includes dedicated inputs for origin, region, varietal, and process so a bean like `Ethiopia Guji Heirloom` can be represented cleanly
- Uses a roast profile selector mapped to the typed enum values
- Saves immediately to local persistence and returns to stash

### Journal

- Route: `/journal`
- Shows recent brews in reverse chronological order
- Provides a primary action to log a brew

### New brew

- Route: `/journal/new`
- Allows selecting only beans with `archivedAt === null` and `remaining > 0`
- Shows live ratio preview from `yield / dose`
- Explains that dose deducts from stash
- Prevents invalid saves when dose exceeds remaining

### Insights

- Route: `/insights`
- Shows low-stock summary
- Shows top tasting notes from stored brew data
- Shows a small rule-based helper from the most recent brew notes
- Excludes advanced charts from MVP

### Navigation

- Use a fixed bottom navigation with **Stash**, **Journal**, and **Insights**
- Keep tap targets large and labels always visible

## 9. Implementation Phases

### Phase 1: Foundation

- Add Tailwind, Lucide, and PWA dependencies
- Set up `app/` structure and global styles
- Configure manifest, icons, and static-generation-friendly Nuxt settings

### Phase 2: Domain and storage

- Define shared types for beans and brews
- Implement IndexedDB storage helpers using `idb`
- Build composables for loading, creating, editing, archiving, and deleting data

### Phase 3: Stash and journal

- Build stash list and new bean form
- Build journal list and new brew form
- Wire business rules for remaining weight updates and validation

### Phase 4: Insights and polish

- Add low-stock summary
- Add tasting note aggregation
- Add dialing-in helper
- Refine empty states, accessibility labels, and installable PWA behavior

## 10. Acceptance Criteria

The MVP is complete when all of the following are true:

- A user can add beans and still see them after closing and reopening the app
- A user can log a brew against a bean and the bean’s `remaining` weight updates correctly
- Invalid brews cannot be saved when dose exceeds remaining
- Archived beans no longer appear as options for new brews
- Existing brews still render when their bean is archived
- Insights show low-stock beans and top tasting notes from local data
- The app loads and remains usable without network access after the initial install/load
- The app can be deployed as a generated static site

## 11. References

- **Nuxt PWA Module:** `@vite-pwa/nuxt`
- **Tailwind with Nuxt:** Tailwind CSS via the Nuxt/Vite integration
- **Lucide Vue Icons:** `@lucide/vue-next`
- **IndexedDB wrapper:** `idb`

By following this plan, **BeanStalk** stays aligned with the intended MVP: a clean, offline-first coffee tracker that is small in scope, straightforward to implement, and safe to grow later.
