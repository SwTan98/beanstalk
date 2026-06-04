# Copilot Instructions

## Build, test, and lint commands

Use `pnpm`; the repo has a committed `pnpm-lock.yaml`.

| Task | Command | Notes |
| --- | --- | --- |
| Install dependencies | `pnpm install` | Runs `nuxt prepare` through `postinstall`. |
| Start the dev server | `pnpm dev` | Default Nuxt local development server. |
| Build for production | `pnpm build` | Produces the Nitro server build in `.output/`. |
| Generate a static build | `pnpm generate` | Use for static hosting workflows. |
| Preview the production build | `pnpm preview` | Runs the built app locally. |
| Run the built server directly | `node .output/server/index.mjs` | Matches the current Nitro `node-server` output. |

There are currently no repository-defined test scripts or lint scripts in `package.json`, so there is no single-test command yet.

## High-level architecture

- This repo is the start of **BeanStalk**, a coffee bean tracking application. The implementation spec lives in `beanstalk.md`, and the approved plan in the session work tracks the MVP as an **offline-first Nuxt app** for bean stash management, brew logging, and insights.
- The checked-in app code is still minimal: `app/app.vue` is the current root component, and `nuxt.config.ts` only contains basic Nuxt configuration. Future product work should build on this scaffold rather than treating the current UI as representative of the final structure.
- The intended application architecture is:
  - **Nuxt app UI** in `app/` with mobile-first screens for stash, journal, and insights
  - **Typed bean and brew domain models** with derived values such as remaining weight and brew ratio
  - **Client-side persistence** behind a small storage API, with IndexedDB as the planned default
  - **Centralized application state** for beans and brews, with business rules like deducting bean weight when saving a brew
  - **PWA behavior** for installability and offline usage, with static deployment readiness
- `tsconfig.json` delegates to Nuxt-generated `.nuxt/tsconfig.*` files. Lean on Nuxt's generated types and conventions instead of introducing a separate custom TypeScript setup unless there is a clear need.

## Key conventions

- **Treat `beanstalk.md` as the product source of truth.** Keep implementation aligned with its core concepts: stash (bean inventory), brew journal/logging, and insights.
- **Build the MVP as offline-first.** The current plan explicitly keeps cloud sync, monetization, and advanced analytics out of the first implementation unless the user asks for them.
- **Keep persistence and business rules separate from UI components.** UI should collect and display data; storage helpers/state layers should own persistence, remaining-weight updates, low-stock checks, and brew validation.
- **Use the `app/` directory as the main source root.** Add pages, layouts, components, and composables there rather than editing generated Nuxt output.
- **Do not edit generated artifacts.** `.nuxt/`, `.output/`, and `node_modules/` are generated and should only be read when debugging framework output.
- **Prefer BeanStalk terminology in code and copy.** Reuse names like `bean`, `brew`, `stash`, `journal`, `insights`, `remaining`, and `threshold` so the code stays aligned with the spec and planned data model.
