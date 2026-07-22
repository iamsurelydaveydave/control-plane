// https://nuxt.com/docs/api/configuration/nuxt-config
declare const process: { env: Record<string, string | undefined> };

export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxt/image"],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  // Icons are fetched from Iconify API (icones.js.org) at runtime.
  // Browse available icons at https://icones.js.org
  icon: {
    // Use Iconify API for fetching icons (default behavior without local packages)
    serverBundle: false,
  },

  runtimeConfig: {
    public: {
      // Cookie config for useCookie() — mainly affects writes.
      // In dev, don't set domain (matches backend's host-only cookie).
      // The backend sets the real cookie options; this is just for client-side reads/writes.
      cookieConfig:
        process.env.NODE_ENV === "production"
          ? {
              domain: process.env.COOKIE_DOMAIN,
              secure: true,
              maxAge: 30 * 24 * 60 * 60,
            }
          : {
              maxAge: 30 * 24 * 60 * 60,
            },
    },
  },

  // Proxy /api routes to the backend.
  // In production, Caddy handles this; in dev/SSR, Nuxt proxies.
  routeRules: {
    "/api/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/**`,
    },
  },

  devServer: {
    port: 4000,
  },

  compatibilityDate: "2026-06-30",

  eslint: {
    config: {
      stylistic: {
        commaDangle: "never",
        braceStyle: "1tbs",
      },
    },
  },
});
