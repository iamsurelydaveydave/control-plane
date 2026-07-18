export default defineNuxtPlugin(() => {
  const router = useRouter()
  const { currentUser, validateSession, loggedInUser } = useAuth()

  router.afterEach(async (to) => {
    const isSecured = to.meta?.secured
    if (!isSecured) return

    // Already resolved this session in the SPA — no need to re-check.
    if (currentUser.value) return

    // Confirm the httpOnly `sid` is still valid server-side. `validateSession`
    // clears the stale `currentUser` + identity cookies on a hard auth failure,
    // so we don't bounce back to a login page that still shows the old email.
    const valid = await validateSession()
    if (valid) return

    // Only bounce to the login page when the session is DEFINITIVELY gone:
    // `validateSession` clears the identity cookie on a hard 401, so an absent
    // `user` cookie means signed-out. A transient failure (offline, 5xx, a CORS
    // blip) leaves the cookie intact — don't sign a still-valid user out on a
    // hiccup; the per-request server auth still guards every data call.
    if (!loggedInUser()) navigateTo('/login')
  })
})
