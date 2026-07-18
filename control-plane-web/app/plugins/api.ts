/**
 * API plugin — creates a typed $fetch instance for API calls.
 *
 * Uses Nuxt route rules to proxy requests, so cookies work properly.
 */
export default defineNuxtPlugin(() => {
  const config = useRuntimeConfig()

  const api = $fetch.create({
    baseURL: config.public.apiUrl as string,
    credentials: 'include'
  })

  return {
    provide: {
      api
    }
  }
})
