# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

BeanStalk is an offline-first Nuxt 3 PWA for tracking a coffee bean stash, logging brews, and surfacing simple insights. The full product/implementation spec lives in `beanstalk.md` — treat it as the source of truth for scope and business rules. The MVP described there (stash, journal, insights, IndexedDB persistence, PWA) is fully implemented in `app/`.

## Commands

Use `pnpm` (a `pnpm-lock.yaml` is committed).

| Task | Command | Notes |
| --- | --- | --- |
| Install dependencies | `pnpm install` | Runs `nuxt prepare` via `postinstall`. |
| Start dev server | `pnpm dev` | http://localhost:3000 |
| Build (server) | `pnpm build` | Produces Nitro output in `.output/`. |
| Generate static site | `pnpm generate` | Static output in `.output/public`; this is the deployment target (see below). |
| Preview production build | `pnpm preview` | Runs the built app locally. |

There are no test or lint scripts defined in `package.json` — do not assume `pnpm test`/`pnpm lint` exist. When verifying changes, run `pnpm dev` (or `pnpm generate`) and check the app in a browser.

## Deployment

`.github/workflows/deploy-pages.yml` deploys to GitHub Pages on push to `master`: it runs `pnpm generate` and publishes `.output/public`. The base URL is computed from `NUXT_APP_BASE_URL` (root `/` when `public/CNAME` is present, otherwise `/<repo-name>/`), and `nuxt.config.ts` derives all asset/manifest URLs from that same variable via the `withBase()` helper. Keep any new hardcoded asset paths going through `withBase()` rather than assuming root-relative paths.

`nitro.prerender.routes` in `nuxt.config.ts` lists every route that must be prerendered for the static build (`/`, `/stash`, `/stash/new`, `/journal`, `/journal/new`, `/insights`). **New top-level routes must be added to this list**, or they won't exist in the static/PWA build.

## Architecture

Four layers, in order of dependency (upper layers depend on lower ones, never the reverse):

1. **Pages/components** (`app/pages/`, `app/components/`) — collect input and render state. Should not talk to IndexedDB directly and should not contain business rules.
2. **`app/composables/useBeanstalk.ts`** — the single composable for all bean/brew state. Owns in-memory reactive state (via `useState`), mutation methods (`createBean`, `archiveBean`, `createBrew`, `updateBrew`, `deleteBrew`), and derived/computed values (`activeBeans`, `lowStockBeans`, `topTastingNotes`, `dialingInTip`, etc.). There is no Pinia/Vuex — all app state flows through this one composable's `useState` keys (`beanstalk:beans`, `beanstalk:brews`, ...), which is why it's global rather than instantiated per-component.
3. **`app/utils/storage.ts`** — the IndexedDB data-access layer (via `idb`). Exposes `listBeans`/`saveBean`/`archiveBean`, `listBrews`/`getBrew`/`createBrewWithBeanUpdate`/`updateBrewWithBeanAdjustments`/`deleteBrewWithBeanRestore`. This is the *only* place that reads/writes stores, and it's where the core business rule lives: **a brew's `dose` is atomically deducted from/restored to its bean's `remaining` in the same IndexedDB transaction**, including when editing a brew across two different beans.
4. **`app/utils/domain.ts` / `app/utils/types.ts`** — pure, framework-free domain logic and types shared by the layers above: `Bean`/`Brew`/`BeanDraft`/`BrewDraft` types, validation-adjacent constants (`DEFAULT_BEAN_THRESHOLD`, `ROAST_PROFILES`, `BREW_METHODS`), formatting helpers (`formatWeight`, `formatRatio`, `formatDuration`), sorting (`sortBeans`, `sortBrews`), and the rule-based `getDialingInTip()` insight helper.

Additional structural notes:

- **Storage schema/versioning is split across three files**: `app/utils/storage-schema.ts` declares the `idb` `DBSchema` (stores: `beans`, `brews`, `meta`) and the current `DATABASE_VERSION`/`STORAGE_SCHEMA_VERSION`; `app/utils/storage-upgrades.ts` holds the ordered list of `IDBPDatabase` upgrade steps (creating stores/indexes) run in `openDB`'s `upgrade` callback; `storage.ts` additionally runs a data-level migration (`ensureSchemaCompatibility`/`migrateToSchemaVersion1`) tracked via the `meta` store, separate from IndexedDB's own version bump. When changing the `Bean`/`Brew` shape, you generally need to touch all three: bump `DATABASE_VERSION` and/or `STORAGE_SCHEMA_VERSION`, add an upgrade step, and add a `StoredX`/`XFromStorage`/`XToStorage` migration if old records need normalizing.
- **`getDatabase()` throws if called outside the client** (`import.meta.client` guard) — IndexedDB access must stay client-only; nothing in `storage.ts` runs during SSR/prerender. `nuxt.config.ts` sets `ssr: false`, so all pages are effectively client-rendered anyway.
- Hydration from IndexedDB into reactive state happens once via `ensureHydrated()` (dedup'd by a module-level `hydrationPromise`), triggered from `app/app.vue`'s `onMounted`. Composable methods that mutate data call `await ensureHydrated()` first to guarantee state is loaded before mutating.
- Routing is filesystem-based Nuxt pages under `app/pages/`: `/`, `/stash`, `/stash/new`, `/journal`, `/journal/[id]/edit`, `/journal/new`, `/insights`. Bottom nav (`AppBottomNav.vue`) is fixed and covers Stash/Journal/Insights.

## Key conventions

- **BeanStalk terminology**: use `bean`, `brew`, `stash`, `journal`, `insights`, `remaining`, `threshold` in code and copy — keep aligned with `beanstalk.md`.
- **Keep persistence and business rules out of components.** New rules (validation, remaining-weight math, low-stock checks) belong in `domain.ts` (pure logic) or `storage.ts`/`useBeanstalk.ts` (stateful/persisted logic), not inline in `.vue` files.
- **Bean/brew mutations always go through IndexedDB transactions that keep `Bean.remaining` and `Brew.dose` consistent.** Don't write ad hoc `saveBean`/direct store calls that update one without the other — follow the pattern in `createBrewWithBeanUpdate`/`updateBrewWithBeanAdjustments`/`deleteBrewWithBeanRestore`.
- **Archived beans are never deleted** (`archivedAt` is set, not removed) and their historical brews must keep rendering; only active beans with `remaining > 0` are selectable for new brews (`selectableBeans` in `useBeanstalk.ts`).
- **No Pinia.** State management is intentionally `useState()` + composables per `beanstalk.md`; don't introduce Pinia or another state library unless explicitly asked.
- **Storage layer is `idb`, not localStorage/Dexie.** Keep it this way unless asked otherwise.
- Code style (see `app/utils/*.ts`): single quotes, no semicolons, 2-space indent. `nuxt.config.ts` (project root) uses double quotes/semicolons — match whichever file you're editing.
- `tsconfig.json` only references generated `.nuxt/tsconfig.*.json` files — don't hand-roll a separate TS config; rely on Nuxt's generated project references.
- Don't edit generated output: `.nuxt/`, `.output/`, `.data`, `.nitro`, `.cache`, `dist`, `node_modules`.
- `.github/copilot-instructions.md` describes an earlier, pre-implementation state of this repo (says the app is "still minimal" with only `app.vue`) — it is stale; this file supersedes it.
