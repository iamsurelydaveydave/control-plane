/**
 * API plugin — creates a typed $fetch instance for API calls.
 *
 * Uses Nuxt route rules to proxy requests, so cookies work properly.
 */
export default defineNuxtPlugin(() => {
  const api = $fetch.create({
    baseURL: "/api",
    credentials: "include",
  })

  return {
    provide: {
      api,
    },
  }
})
