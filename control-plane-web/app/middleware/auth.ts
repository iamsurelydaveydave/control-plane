export default defineNuxtRouteMiddleware(async (to) => {
  // Ensure middleware runs only on the client side
  if (import.meta.server) return

  const { cookieConfig } = useRuntimeConfig().public

  // The real session secret (`sid`) is httpOnly, so client-side JS can NEVER read
  // it — only the server can (it validates `sid` on every API call via
  // requireAuth). For the SPA's own redirect gate we therefore read the readable,
  // non-secret `user` hint that is issued alongside `sid` at login. This is
  // UX-only; faking it just yields an empty shell, since every data call is still
  // authorized server-side.
  const user = useCookie('user', cookieConfig).value

  if (!user) {
    // Preserve the intended destination so login can return the user there
    // afterwards. Skip for the landing page itself to avoid a redundant `?redirect=/`.
    const redirect
      = to.fullPath && to.fullPath !== '/' ? to.fullPath : undefined
    return navigateTo(
      redirect ? { path: '/login', query: { redirect } } : '/login'
    )
  }
})
