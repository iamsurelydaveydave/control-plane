/**
 * API plugin — creates a typed $fetch instance for API calls.
 *
 * In development: Uses Nuxt route rules to proxy requests (/api → backend).
 * In production (Cloudflare Workers SPA): Calls the API directly via apiUrl.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  // In production SPA mode (Cloudflare), use the full API URL.
  // In development, use the proxy (/api → backend).
  const isProduction = import.meta.env.PROD
  const baseURL = isProduction && config.public.apiUrl
    ? `${config.public.apiUrl}/api`
    : '/api'

  const api = $fetch.create({
    baseURL,
    credentials: 'include'
  })

  return {
    provide: {
      api
    }
  }
})
