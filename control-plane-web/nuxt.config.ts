// https://nuxt.com/docs/api/configuration/nuxt-config
declare const process: { env: Record<string, string | undefined> };

export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxt/image"],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

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

  // Proxy API routes to the backend — Nuxt handles cookie forwarding automatically
  routeRules: {
    "/api/auth/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/auth/**`,
    },
    "/api/setup/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/setup/**`,
    },
    "/api/users/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/users/**`,
    },
    "/api/servers/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/servers/**`,
    },
    "/api/apps/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/apps/**`,
    },
    "/api/databases/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/databases/**`,
    },
    "/api/ssh-keys/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/ssh-keys/**`,
    },
    "/api/api-tokens/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/api-tokens/**`,
    },
    "/api/secrets/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/secrets/**`,
    },
    "/api/audit-logs/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/audit-logs/**`,
    },
    "/api/alerts/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/alerts/**`,
    },
    "/api/settings/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/settings/**`,
    },
    // K8s-native resources
    "/api/clusters/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/clusters/**`,
    },
    "/api/nodes/**": {
      proxy: `${process.env.API_URL || "http://localhost:5005"}/api/nodes/**`,
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
