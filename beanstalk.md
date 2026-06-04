# BeanStalk (Coffee Brew Tracker) – Nuxt Implementation Plan

This plan translates the existing React/Next.js spec into a Nuxt 3 (Vue 3) Progressive Web App, covering architecture, data storage, UI components, deployment, and monetization. Key updates include using Nuxt’s PWA support, Tailwind CSS integration, and client-side storage for a zero-infrastructure approach.

## 1. Framework & Architecture

- **Nuxt 3 & Vite:** Use Nuxt 3 (Vue 3) instead of React/Next. Nuxt provides server-side rendering (SSR) or static site generation out of the box, with a familiar file-based **`pages/`** routing structure. It also uses Vite under the hood for fast builds. The transition from React is straightforward: components become Vue components (templates + `<script setup>`), and JSX icon libraries (e.g. Lucide React) are replaced by Vue counterparts.  
- **PWA Support:** Install the Nuxt PWA module `@vite-pwa/nuxt`. This zero-config plugin auto-generates a Web App Manifest and service worker with offline caching (via Workbox). In `nuxt.config.ts`, include:
  ```js
  import { defineNuxtConfig } from 'nuxt/config'
  export default defineNuxtConfig({
    modules: ['@vite-pwa/nuxt'],
    pwa: { /* PWA options (icons, name, theme color) */ }
  })
  ```
  This enables “add to home screen” installability and offline asset caching.  
- **Styling – Tailwind CSS:** Integrate Tailwind via the official plugin. Install `tailwindcss @tailwindcss/vite` and add it as a Vite plugin in `nuxt.config.ts` (see Tailwind docs). Then create an assets CSS file (e.g. `~/assets/css/main.css`) importing Tailwind, and add it to the `css` array. This utility-first setup ensures a **minimalist UI** with custom spacing, colors, and rounded corners.  
- **Icons – Lucide (Vue):** Use the Vue version of Lucide icons for a lightweight icon set. Lucide provides each icon as a tree-shakable Vue component. For example, install `@lucide/vue-next` and import icons (e.g. `<IconCoffee/>`). These vector icons fit the clean aesthetic with stroke style.  

## 2. PWA Setup & Core Modules

- **Install & Configure PWA:** After adding `@vite-pwa/nuxt`, configure the manifest (app name “BeanStalk”, theme colors, icons) and Workbox strategies if needed. The module will generate default `manifest.json` and service worker automatically. Ensure `public/` has fallback offline HTML if desired.  
- **Offline Data Caching:** Leverage the service worker to precache static assets (JS, CSS, icons). For dynamic data (beans/journal entries), rely on client-side storage (see next section) because Supabase cannot operate offline.  
- **Mobile-First Design:** The UI will be **mobile-first** (thumb-friendly tap targets, large inputs). Use Tailwind utility classes (e.g. `p-4`, `text-lg`, `rounded-xl`) to ensure buttons and inputs are easy to tap in a kitchen environment. Maintain high contrast (deep-brown backgrounds, off-white cards) and plenty of whitespace per the design vibe.  

## 3. Data Storage Strategy (Zero-Infrastructure)

To avoid any backend or server costs, BeanStalk will store data entirely on the device. Options:

- **IndexedDB (Recommended):** Use IndexedDB (via a library like [idb](https://github.com/jakearchibald/idb) or [Dexie](https://dexie.org/)) to store structured data offline. IndexedDB is asynchronous and suited for complex data (keyed objects, blobs). For example, create an “beans” object store and a “brews” store. Libraries like Dexie simplify schema definition and queries.  
- **LocalStorage (Fallback):** For very simple implementation, localStorage can be used to store JSON strings, but this is synchronous and not ideal for larger data or offline writes. If usage is minimal, one could JSON.stringify the entire data model into localStorage on each change.  
- **Supabase (Optional Cloud Sync):** As an *optional* feature, Supabase (PostgreSQL) can be used for cloud backup/sync. However, **Supabase does not work offline** – any data entry made while offline must be saved locally then synced later. Building a full offline-sync (with conflict resolution) is complex. If implemented, treat Supabase as a passive backup: on app start or when user goes online, push local IndexedDB changes to Supabase via its JS client. (In practice, for a side project and single-device use, you might skip Supabase entirely.)  
- **Data Persistence:** Regardless of storage choice, ensure data persists between sessions. For instance, after each bean or brew is saved, write to IndexedDB. On app load, read all records into state.  

## 4. Data Model Design

Define two main entities: **Bean** (stash item) and **Brew Log** (journal entry). Example schemas:

- **Bean (Stash)**:  
  ```json
  {
    "id": "uuid",           // unique identifier
    "name": "Kenya AA",
    "roaster": "Roaster Name",
    "origin": "Kenya",
    "process": "Washed",
    "roastProfile": "Light-Medium", // text label
    "startWeight": 250,    // grams
    "remaining": 180,      // grams (updated as brews are logged)
    "threshold": 30,       // optional threshold for low alert
    "createdAt": "...",
    "archived": false
  }
  ```
  - **Derived fields**: “remaining” is decremented whenever a brew is logged using this bean. “threshold” (e.g. 30g) triggers a low-stock alert.  
- **Brew Log (Journal)**:  
  ```json
  {
    "id": "uuid",
    "beanId": "uuid-of-bean",
    "date": "...", 
    "method": "V60",
    "grinder": "1Zpresso K-Ultra",
    "dose": 16,       // grams of coffee
    "yield": 240,     // grams of liquid
    "brewTime": "02:30", 
    "pours": "50g bloom, pour to 150g, pour to 240g",
    "tastingNotes": ["Floral","Berry"], // tags
    "ratio": 15      // computed as yield/dose (1:15)
  }
  ```
  - **Relationships**: Each brew references a bean via `beanId`.  
  - **Computed**: The brew ratio can be computed on the fly (`yield/dose`) and optionally stored.  
- **Insights Data**: This is derived from existing beans and brews. For example, aggregate tasting notes for the “Flavor Cloud”, or scan recent notes for keywords.  

These data can be stored in IndexedDB object stores named “beans” and “brews”. On startup, the app loads these into reactive state (using Nuxt’s `useState` or Pinia store). Every create/update is written back to IndexedDB to persist.

## 5. UI Components & Screens

Design the Vue components and pages corresponding to the three core screens. Use Tailwind for styling and Lucide icons for UI cues.

1. **Add to Stash (Bean Inventory Form)** – *Route:* `/stash/new` or a modal.  
   - **Header**: “New Beans” (caps lock styling consistent with copy rules).  
   - **Inputs**: Fields for **Roaster**, **Origin**, **Process** (text inputs).  
   - **Starting Weight (g)**: Prominent numeric input (e.g. `<input type="number">` with placeholder “250”).  
   - **Roast Profile Slider**: A range slider (`<input type="range">`) styled with a color gradient from tan to dark brown. As the thumb moves, a label updates (“Light”, “Light-Medium”, etc) and an icon (coffee bean) changes color or fill intensity. This is achievable with Vue reactivity (watching the slider value and mapping to descriptors).  
   - **Button**: “Save” (or “Add Beans”) with full-width and visible.  
   - Use large padding (`py-3 px-4`) and rounded corners on all inputs/buttons for thumb-friendly taps.  

2. **Log Brew (Journal Entry Form)** – *Route:* `/journal/new`.  
   - **Header**: “New Brew”.  
   - **Select Bean**: Dropdown (`<select>`) listing active bean names with remaining weight (e.g. “Kenya AA – 180g left”). On change, set `beanId` in form state.  
   - **Dose (g)** and **Yield (g)**: Two number inputs side by side or stacked (with labels). As the user types, a **computed field** displays the ratio (e.g. “1:15”) dynamically (use a Vue computed property).  
     - Next to the Dose field, show a small badge/tooltip “Deducts from Stash” with an icon (indicating that saving this brew will reduce the bean’s remaining weight).  
   - **Grind Size** (number) and **Brew Time** (text or time input) fields.  
   - **Pours**: A textarea with placeholder “e.g., 50g bloom, pour to 150g, pour to 250g”.  
   - **Tasting Notes**: A tag selector component. Predefine common tags (e.g. Clarity-forward, Floral, Berry) displayed as selectable chips. Allow the user to add a custom note (“+ Add Note”) which becomes a new tag. Store these as an array.  
   - **Save Brew** button: When clicked, the brew object is saved and the corresponding bean’s `remaining` is decremented by the dose. Validate to prevent overdrawing (dose > remaining).  
   - Use large labels and grouping for quick thumb entry.  

3. **Stash Status & Insights** – *Route:* `/insights`.  
   - **Header**: “Stash & Insights”.  
   - **Inventory List**: Display all active beans with a simple card for each: name, origin, process, remaining weight. At the top or in a separate banner, show a **Low-Stock Alert** for any bean at or below its threshold (e.g. “⚠️ Running Low: Kenya AA – Only 30g left (≈2 brews). Time to re-stock!”) with a contrasting background (soft amber/terracotta). Include an “Archive Bean” quick button that marks this bean as used up. This banner text follows the friendly style from the prompt.  
   - **Flavor Cloud**: Visualize tasting notes frequency. This could be a simple tag cloud or a list of tags sized by count. E.g., display tags like “Floral” or “Berry” with font size proportional to how often they appear in past brews. (If building an actual cloud is complex, a sorted list of “Top Notes” can suffice.)  
   - **Dialing-In Helper**: A card with a suggestion. Detect if the user’s last brew notes contain words like “astringent” or “bitter”. If so, display a message: “Your last brew was slightly astringent. Try grinding coarser or pouring faster to improve clarity.” Otherwise, show general tips or nothing. This is a simple rule-based engine using the stored tasting notes.  
   - **Stats/Charts (Optional)**: As part of Insights, you could show consumption patterns (e.g. “Brews per week” chart), or average brew ratio. For a minimalist build, this can be omitted or simplified.  

4. **Navigation & Layout:** Implement a fixed bottom navigation bar with three tabs (Stash, Journal, Insights), each with an icon (e.g. a box for stash, a coffee mug for journal, a chart or lightbulb for insights) and label. Use Tailwind (`fixed bottom-0 w-full flex`) for layout. Ensure the design across screens is cohesive: same fonts, colors, and button styles.  

All components should use the same design system (Tailwind classes, a consistent color palette of dark-brown, amber, off-white) and copy style (short, punchy labels). The *Google Stitch* prompt’s example data (Kenya AA, Washed, 1:15 ratio, notes “Floral, Berry”) can be used as default placeholders in forms to illustrate usage.

## 6. Implementation Details

- **State Management:** Nuxt’s built-in reactivity (e.g. `useState` or Pinia) can hold the array of beans and brews in-memory. Alternatively, use the [`useState()`](https://nuxt.com/docs/guide/state) composable for lightweight state. Every time state changes (e.g. new bean or brew), also write to IndexedDB/localStorage.  
- **Computed Properties & Watchers:**  
  - Calculate brew ratio as a computed property: `ratio = (yield/dose).toFixed(0)`, displayed as `1:ratio`.  
  - Watch for a bean’s `remaining` weight to trigger the low-stock banner when `remaining <= threshold`.  
  - Update remaining weight: when saving a brew, do `bean.remaining -= brew.dose` and persist that.  
- **Local Database API:** Use a small service/utility module wrapping IndexedDB. For example, with the [idb](https://github.com/jakearchibald/idb) library you can define stores and call `db.put('beans', beanObj)` and `db.getAll('beans')`. On app startup (Nuxt `onMounted` or a plugin), load all data from IndexedDB into state. After any write, immediately sync. This ensures full offline capability.  
- **Rule Engine (Tasting Notes):** For each brew note tag, you could tag it as “positive/negative” in a simple object. E.g. `if tags include "bitter" or "astringent", flag dryness`. The helper card just needs a few if-else rules to suggest grind/flow rate adjustments. These rules can be hard-coded in JavaScript.  
- **Accessibility:** Ensure all buttons and form fields have labels or aria-labels. The bottom nav icons should have accompanying text for clarity.  

## 7. Deployment

- **Build & Host:** Since there’s no server-side business logic, this can be deployed as a static PWA (or lightly SSR) site. Use Netlify or Vercel for zero-config hosting. Both platforms auto-detect Nuxt 3 and build with `npm run build`. For Netlify, Nuxt will publish from `dist/`; for Vercel, simply import the Git repo and it will recognize the Nuxt/Nitro setup.  
- **Continuous Deployment:** Link your GitHub repo to the host. Every push to `main` triggers a new build/deploy. This satisfies the “deploy once and run indefinitely” mantra. No manual server upkeep is needed.  
- **Custom Domain:** Use a custom domain (e.g. beanstalk.coffee) via the hosting service. Ensure HTTPS (free on Netlify/Vercel).  
- **PWA Activation:** After deployment, test the “Add to Home Screen” prompt on mobile browsers. The manifest (auto-generated by the PWA plugin) should include name, icons, and theme colors. The service worker should cache static assets on first load for offline capability.  

## 8. Maintenance & Monetization

- **Maintenance:** With no backend, maintenance is minimal. Bug fixes or new features just require a code update and redeploy. The app runs purely in the client’s browser, so there are no server costs or database migrations. Monitor any dependencies (Vue, Nuxt) for updates, but routine maintenance should be very light.  
- **Monetization (Side Income):** Implement the strategies from the original spec to keep things passive and optional:  
  1. **Tip Jar:** Add a prominent “Buy Me a Bag of Beans” button (e.g. linking to Stripe Checkout or a BuyMeACoffee widget). This invites users to donate if they find the app useful.  
  2. **One-Time Unlock:** Offer a small premium (e.g. RM15) via a service like Lemon Squeezy or Paddle. Upon payment, the app could unlock extra cosmetic features (dark mode, custom themes) or advanced charts (using a simple flag stored in localStorage to check purchase). Since there’s no backend, actual entitlement could be based on a redeemable code or storing a token. (For simplicity, you might simulate this with a “premium unlocked” flag once payment is confirmed.)  
  3. **Affiliate Links:** In the Insights screen or a gear page, recommend coffee gear (grinders, scales, filters) with affiliate URLs. These could be styled as minimal banner ads or linked images. Because this is client-only, the links open the affiliate partner site outside the PWA.  

No ads or subscriptions are needed, keeping the experience clean. All monetization actions are front-end (buttons/links), so there’s no extra infrastructure. 

## References

- **Nuxt PWA Module:** The [@vite-pwa/nuxt](https://nuxt.com/modules/vite-pwa-nuxt) plugin provides offline support and manifest generation.  
- **Tailwind with Nuxt:** Tailwind CSS can be installed via the `@tailwindcss/vite` plugin and configured in `nuxt.config.ts`.  
- **Lucide Vue Icons:** Lucide offers a Vue icon library with tree-shakable SVG components.  
- **Offline Storage (IndexedDB):** IndexedDB is recommended for structured PWA data (asynchronous, persistent). LocalStorage is an alternative for simple key/value, but not suited for complex data.  
- **Supabase Offline Limitations:** Supabase (Postgres) has no built-in offline mode; offline apps must store data locally and sync manually. This validates the client-only storage approach.  
- **Deployment:** Nuxt auto-detects Netlify and Vercel for zero-config deployment.

By following this plan, **BeanStalk** will be a fully client-side Nuxt PWA with a clean UI, offline capabilities, and minimal upkeep, while preserving the original vision of a lightweight coffee journaling tool.