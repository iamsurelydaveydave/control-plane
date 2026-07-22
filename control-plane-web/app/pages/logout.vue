<script setup lang="ts">
/**
 * Logout page — clears session, cookies, and redirects to login.
 *
 * Routing through a dedicated page ensures all cleanup happens in a fresh
 * navigation context, avoiding stale reactive state issues.
 */
definePageMeta({ layout: 'default' })

const cookieConfig = useCookieConfig()
const { currentUser } = useAuth()

async function performLogout() {
  // 1. Call the API to destroy the server-side session
  try {
    await useNuxtApp().$api('/auth/logout', { method: 'DELETE' })
  } catch {
    // Ignore — still clear client-side state even if API call fails
  }

  // 2. Clear client-side state
  currentUser.value = null

  // 3. Clear cookies
  useCookie('user', cookieConfig).value = null

  // 4. Small delay to ensure cookie is flushed, then redirect
  await new Promise(resolve => setTimeout(resolve, 100))
  await navigateTo('/login', { replace: true })
}

onMounted(() => {
  performLogout()
})
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center">
    <div class="text-center">
      <UIcon
        name="i-lucide-loader-circle"
        class="size-8 animate-spin text-primary"
      />
      <p class="mt-4 text-muted">
        Signing out...
      </p>
    </div>
  </div>
</template>
