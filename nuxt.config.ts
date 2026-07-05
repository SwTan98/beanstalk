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
    optimizeDeps: {
      // Pre-bundle the heavy CJS scan deps at startup so the first scan doesn't trigger
      // a mid-flow dev-server reload (which loses in-progress form state).
      include: ["@lucide/vue", "idb", "@techstark/opencv-js", "tesseract.js"],
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id: string) {
            if (id.includes("@techstark/opencv-js")) {
              return "opencv";
            }
          },
          chunkFileNames: (chunkInfo) =>
            chunkInfo.name === "opencv"
              ? "_nuxt/opencv-[hash].js"
              : "_nuxt/[hash].js",
        },
      },
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
      // Keep the ~3 MB OCR/CV assets out of the precache; they load lazily on the first
      // scan and are runtime-cached below so later scans work offline.
      globIgnores: ["**/opencv-*.js", "tesseract/**"],
      runtimeCaching: [
        {
          urlPattern: ({ url }: { url: URL }) =>
            url.pathname.includes("/tesseract/"),
          handler: "CacheFirst",
          options: {
            cacheName: "tesseract-assets",
            expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
        {
          urlPattern: ({ url }: { url: URL }) => url.pathname.includes("opencv-"),
          handler: "CacheFirst",
          options: {
            cacheName: "opencv-assets",
            expiration: { maxEntries: 5, maxAgeSeconds: 60 * 60 * 24 * 365 },
            cacheableResponse: { statuses: [0, 200] },
          },
        },
      ],
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
