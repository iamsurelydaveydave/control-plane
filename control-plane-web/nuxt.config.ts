// https://nuxt.com/docs/api/configuration/nuxt-config
declare const process: { env: Record<string, string | undefined> };

export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxt/image"],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  // Bundle all icons at build time so they're available on first render
  // instead of being loaded on demand at runtime (which requires the API endpoint)
  icon: {
    clientBundle: {
      // Scan all source files and bundle every icon used
      scan: true,
    },
  },

  runtimeConfig: {
    public: {
      // Client uses relative path (goes through the proxy routeRules)
      apiUrl: "/api",
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

  // Proxy API routes to the backend in development
  // In production, Caddy handles /api/* routing, but we still need the proxy
  // configured for SSR requests from the Nuxt server to the API.
  // API_URL must be set at build time (in Dockerfile) for production.
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
