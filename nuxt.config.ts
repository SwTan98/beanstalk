import tailwindcss from "@tailwindcss/vite";
import { GEMINI_FUNCTION_MAX_DURATION_S } from "./shared/utils/timeouts";
import { isFlagEnabled } from "./shared/utils/flags";

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  ssr: false,
  app: {
    head: {
      title: "BeanStalk",
      meta: [
        {
          name: "theme-color",
          content: "#fcfaf7",
        },
        {
          name: "description",
          content:
            "Offline-first coffee bean tracking for stash, brews, and simple insights.",
        },
        {
          name: "apple-mobile-web-app-capable",
          content: "yes",
        },
        {
          name: "apple-mobile-web-app-status-bar-style",
          content: "default",
        },
        {
          name: "apple-mobile-web-app-title",
          content: "BeanStalk",
        },
      ],
      link: [
        {
          rel: "apple-touch-icon",
          href: "/pwa-192x192.png",
        },
      ],
    },
  },
  runtimeConfig: {
    public: {
      // Non-secret boolean baked into the client bundle at build time
      // (ssr: false SPA) - toggling GEMINI_IMAGE_PARSE requires a redeploy,
      // which any Vercel env change needs anyway. Never expose
      // GEMINI_API_KEY/GEMINI_MODEL here.
      geminiImageParse: isFlagEnabled(process.env.GEMINI_IMAGE_PARSE),
    },
  },
  css: ["~/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
    resolve: {
      alias: [
        // Force the wasm-only ORT build: the default entry is the WebGPU
        // (jsep) build, which fetches jsep wasm binaries we don't self-host.
        { find: /^onnxruntime-web$/, replacement: "onnxruntime-web/wasm" },
      ],
    },
    optimizeDeps: {
      include: ["@lucide/vue", "idb", "ppu-paddle-ocr/web", "onnxruntime-web"],
    },
  },
  modules: ["@vite-pwa/nuxt"],
  nitro: {
    prerender: {
      routes: [
        "/",
        "/stash",
        "/stash/new",
        "/journal",
        "/journal/new",
        "/insights",
      ],
    },
    // Vercel-only: the default Hobby function limit (~10s) is too tight for
    // a cold Gemini structured-output call. See shared/utils/timeouts.ts for
    // how this relates to the server/client timeout budget.
    vercel: {
      functions: {
        maxDuration: GEMINI_FUNCTION_MAX_DURATION_S,
      },
    },
  },
  pwa: {
    registerType: "autoUpdate",
    manifest: {
      name: "BeanStalk",
      short_name: "BeanStalk",
      description:
        "Offline-first coffee bean tracking for stash, brews, and simple insights.",
      theme_color: "#fcfaf7",
      background_color: "#fcfaf7",
      display: "standalone",
      start_url: "/",
      scope: "/",
      icons: [
        {
          src: "/pwa-192x192.png",
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: "/pwa-512x512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    workbox: {
      globPatterns: ["**/*.{html,js,css,ico,png,svg,webmanifest}"],
      // The OCR models/wasm (~43 MB) must never be precached with the app
      // shell; ocr-engine.ts fetches them lazily on first scan and stores
      // them itself via the Cache API (beanstalk-ocr-v1).
      globIgnores: ["ocr/**"],
      // Server routes are real endpoints, never SPA navigations.
      navigateFallbackDenylist: [/^\/api\//],
    },
    client: {
      installPrompt: true,
    },
    devOptions: {
      enabled: true,
      suppressWarnings: true,
    },
  },
});
