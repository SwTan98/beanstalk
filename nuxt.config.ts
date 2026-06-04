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
          content: "#4b3127",
        },
        {
          name: "description",
          content:
            "Offline-first coffee bean tracking for stash, brews, and simple insights.",
        },
      ],
    },
  },
  css: ["~/assets/css/main.css"],
  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ["@lucide/vue", "idb"],
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
      theme_color: "#4b3127",
      background_color: "#f7f0e5",
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
