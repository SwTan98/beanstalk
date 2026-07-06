import tailwindcss from "@tailwindcss/vite";

const appBaseURL = (() => {
  const value = process.env.NUXT_APP_BASE_URL ?? "/";
  return value.endsWith("/") ? value : `${value}/`;
})();

function withBase(path: string) {
  return `${appBaseURL}${path.replace(/^\/+/, "")}`;
}

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: false },
  ssr: false,
  app: {
    baseURL: appBaseURL,
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
          href: withBase("pwa-192x192.png"),
        },
      ],
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
      start_url: appBaseURL,
      scope: appBaseURL,
      icons: [
        {
          src: withBase("pwa-192x192.png"),
          sizes: "192x192",
          type: "image/png",
        },
        {
          src: withBase("pwa-512x512.png"),
          sizes: "512x512",
          type: "image/png",
        },
        {
          src: withBase("pwa-512x512.png"),
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
