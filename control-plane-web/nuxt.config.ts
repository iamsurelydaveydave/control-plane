// https://nuxt.com/docs/api/configuration/nuxt-config
declare const process: { env: Record<string, string | undefined> }

export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/ui', '@nuxt/image'],

  ssr: false, // SPA mode for Cloudflare Workers

  devtools: {
    enabled: true
  },

  css: ['~/assets/css/main.css'],

  // Icons are fetched from Iconify API (icones.js.org) at runtime.
  // Browse available icons at https://icones.js.org
  icon: {
    // Use Iconify API for fetching icons (default behavior without local packages)
    serverBundle: false
  },

  runtimeConfig: {
    public: {
      // API URL for client-side requests (set at build time)
      // e.g., https://api.cplane.goweekdays.com
      apiUrl: process.env.API_URL || 'http://localhost:5005',

      // Cookie domain for cross-subdomain authentication
      cookieDomain: process.env.COOKIE_DOMAIN || '',

      // Cookie max age (30 days)
      cookieMaxAge: 30 * 24 * 60 * 60,

      // Whether cookies should be secure (HTTPS only)
      cookieSecure: process.env.NODE_ENV === 'production'
    }
  },

  // Nitro configuration for Cloudflare Workers
  nitro: {
    preset: 'cloudflare_module',
    cloudflare: {
      deployConfig: true,
      nodeCompat: true
    }
  },

  // In SPA mode, no server-side proxy — client calls API directly.
  // The API_URL env var is baked into runtimeConfig.public.apiUrl at build time.
  // For local dev, we still proxy to avoid CORS issues.
  routeRules: process.env.NODE_ENV === 'production'
    ? {}
    : {
        '/api/**': {
          proxy: `${process.env.API_URL || 'http://localhost:5005'}/api/**`
        }
      },

  devServer: {
    port: 4000
  },

  compatibilityDate: '2026-06-30',

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  }
})
