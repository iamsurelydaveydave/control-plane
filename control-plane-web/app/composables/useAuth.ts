/**
 * useAuth — authentication composable following goweekdays-web pattern.
 *
 * Uses a `user` cookie as a client-side hint. The real session is the httpOnly
 * cookie set by the backend.
 */
export default function useAuth() {
  const { cookieConfig } = useRuntimeConfig().public
  const currentUser = useState<TUser | null>('currentUser', () => null)

  function clearCookies() {
    // NEVER emit destructive Set-Cookie during SSR. The server can't validate the
    // httpOnly `sid` (it isn't attached to server-side `$api` calls), so it must
    // never make a sign-out decision — doing so on a mere page render would delete
    // a perfectly valid user's session cookies and bounce them to the landing
    // page on every refresh. Clearing is only ever correct in response to a
    // client-side action (logout) or a definitive client-side 401.
    if (import.meta.server) return
    useCookie('user', cookieConfig).value = null
  }

  function loggedInUser() {
    return useCookie('user', cookieConfig).value ?? ''
  }

  async function login(email: string, password: string) {
    const data = await useNuxtApp().$api<{ message: string, user: TUser }>('/auth/login', {
      method: 'POST',
      body: { email, password }
    })
    currentUser.value = data.user
    // Set the user cookie client-side as a hint for the auth middleware
    if (import.meta.client && data.user?._id) {
      useCookie('user', cookieConfig).value = data.user._id
    }
    return data
  }

  async function logout() {
    try {
      await useNuxtApp().$api('/auth/logout', { method: 'DELETE' })
    } catch {
      // Ignore
    }
    currentUser.value = null
    clearCookies()
    await navigateTo('/login')
  }

  // True when a caught $fetch error is an authentication failure — i.e. the
  // server rejected the `sid` session (expired or revoked). ofetch surfaces the
  // HTTP status in a few shapes, so check them all.
  function isAuthError(error: unknown): boolean {
    const err = error as { response?: { status?: number }, statusCode?: number, status?: number }
    const status = err?.response?.status ?? err?.statusCode ?? err?.status
    return status === 401
  }

  // Verify the httpOnly `sid` session is still valid on the server. The `sid`
  // itself is invisible to client-side JS, so we can't inspect it directly —
  // instead we hit an auth-gated endpoint (keyed off the readable, non-secret
  // `user` hint) and let the server be the source of truth.
  //
  // The `user` cookie can outlive the real session, so its mere presence does
  // NOT mean the user is signed in. On a 401 we KNOW the session is dead, so we
  // clear the stale client state + identity cookies; landing pages that render
  // "Continue as <email>" then correctly fall back to the signed-out state.
  // Returns whether the session is valid.
  async function validateSession(): Promise<boolean> {
    const user = useCookie('user', cookieConfig).value
    if (!user) {
      currentUser.value = null
      return false
    }

    // The httpOnly `sid` can only be proven where the browser attaches it — a
    // CLIENT-side request. During SSR the server fetch carries no `sid` (it's
    // httpOnly, and the $api plugin injects no real session), so the call would
    // 401 for EVERY signed-in user and wrongly clear their cookies mid-render.
    // Defer the real check to the client and leave the session untouched here.
    if (import.meta.server) return false

    try {
      const data = await useNuxtApp().$api<{ user: TUser }>('/auth/me', { method: 'GET' })
      currentUser.value = data.user
      return true
    } catch (error) {
      // A definitive auth failure means the session has expired/been revoked:
      // drop the stale identity so the UI reflects a signed-out user. Other
      // failures (network blips, 5xx) are left non-destructive.
      if (isAuthError(error)) {
        currentUser.value = null
        clearCookies()
      }
      return false
    }
  }

  async function updateProfile(payload: {
    currentPassword: string
    email?: string
    newPassword?: string
    confirmPassword?: string
  }) {
    const data = await useNuxtApp().$api<{ message: string, user: TUser }>('/auth/me', {
      method: 'PATCH',
      body: payload
    })
    // Reflect email change in local state immediately
    if (data.user && currentUser.value) {
      currentUser.value = { ...currentUser.value, ...data.user }
    }
    return data
  }

  return {
    currentUser,
    loggedInUser,
    login,
    logout,
    updateProfile,
    validateSession
  }
}
