// https://nuxt.com/docs/api/configuration/nuxt-config
declare const process: { env: Record<string, string | undefined> };

export default defineNuxtConfig({
  modules: ["@nuxt/eslint", "@nuxt/ui", "@nuxt/image"],

  devtools: {
    enabled: true,
  },

  css: ["~/assets/css/main.css"],

  // Bundle all icons at build time — both server-side and client-side.
  // This eliminates the need for the /api/_nuxt_icon endpoint entirely.
  // Icons in JS objects/arrays aren't detected by scan, so we list them explicitly.
  icon: {
    serverBundle: "local",
    clientBundle: {
      scan: true,
      // Explicitly list icons used in JS variables (nav items, config objects, etc.)
      // since the scanner only detects icons in template attributes
      icons: [
        "lucide:activity",
        "lucide:alert-circle",
        "lucide:alert-triangle",
        "lucide:arrow-left",
        "lucide:arrow-right",
        "lucide:arrow-right-from-line",
        "lucide:bar-chart-2",
        "lucide:bell",
        "lucide:bell-off",
        "lucide:book-open",
        "lucide:box",
        "lucide:building",
        "lucide:building-2",
        "lucide:check",
        "lucide:check-check",
        "lucide:check-circle",
        "lucide:check-circle-2",
        "lucide:chevron-down",
        "lucide:chevrons-up-down",
        "lucide:circle",
        "lucide:circle-alert",
        "lucide:circle-check",
        "lucide:circle-off",
        "lucide:clipboard-check",
        "lucide:clock",
        "lucide:cloud",
        "lucide:code",
        "lucide:container",
        "lucide:copy",
        "lucide:cpu",
        "lucide:crown",
        "lucide:database",
        "lucide:download",
        "lucide:edit",
        "lucide:ellipsis",
        "lucide:external-link",
        "lucide:eye",
        "lucide:eye-off",
        "lucide:file",
        "lucide:file-down",
        "lucide:file-text",
        "lucide:git-branch",
        "lucide:github",
        "lucide:globe",
        "lucide:grid-2x2",
        "lucide:hard-drive",
        "lucide:hash",
        "lucide:heart-pulse",
        "lucide:history",
        "lucide:info",
        "lucide:key",
        "lucide:key-round",
        "lucide:layers",
        "lucide:layout-dashboard",
        "lucide:layout-grid",
        "lucide:link",
        "lucide:loader",
        "lucide:loader-2",
        "lucide:lock",
        "lucide:log-out",
        "lucide:mail",
        "lucide:maximize",
        "lucide:memory-stick",
        "lucide:message-circle",
        "lucide:minus-circle",
        "lucide:monitor",
        "lucide:moon",
        "lucide:palette",
        "lucide:panel-left",
        "lucide:panel-left-close",
        "lucide:pause",
        "lucide:pause-circle",
        "lucide:play",
        "lucide:plug",
        "lucide:plus",
        "lucide:puzzle",
        "lucide:refresh-cw",
        "lucide:repeat",
        "lucide:rocket",
        "lucide:rotate-cw",
        "lucide:save",
        "lucide:scroll-text",
        "lucide:search",
        "lucide:search-x",
        "lucide:send",
        "lucide:server",
        "lucide:server-off",
        "lucide:settings",
        "lucide:settings-2",
        "lucide:shield",
        "lucide:shield-alert",
        "lucide:shield-check",
        "lucide:shield-off",
        "lucide:ship",
        "lucide:square",
        "lucide:star",
        "lucide:sun",
        "lucide:tag",
        "lucide:terminal",
        "lucide:trash",
        "lucide:trash-2",
        "lucide:undo-2",
        "lucide:upload",
        "lucide:user",
        "lucide:user-plus",
        "lucide:users",
        "lucide:wind",
        "lucide:workflow",
        "lucide:x",
        "lucide:x-circle",
        "lucide:zap",
      ],
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
    // Exclude Nuxt internal endpoints from the proxy
    "/api/_nuxt_icon/**": {},
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
