<script setup lang="ts">
/**
 * Index page — redirects based on setup/auth status.
 */
definePageMeta({ layout: false })

const { checkStatus } = useSetup()
const { loggedInUser } = useAuth()

// Use a timeout to ensure we don't hang forever
onMounted(async () => {
  // Add a timeout fallback
  const timeout = setTimeout(() => {
    console.warn('[index] Redirect timeout, falling back to login')
    navigateTo('/login')
  }, 5000)

  try {
    const initialized = await checkStatus()
    clearTimeout(timeout)
    
    if (!initialized) {
      await navigateTo('/setup')
      return
    }

    // Check cookie hint — if present, go to dashboard
    if (loggedInUser()) {
      await navigateTo('/dashboard')
    } else {
      await navigateTo('/login')
    }
  } catch (err) {
    clearTimeout(timeout)
    console.error('[index] Error checking status:', err)
    await navigateTo('/login')
  }
})
</script>

<template>
  <div class="flex min-h-dvh items-center justify-center bg-default">
    <UIcon
      name="i-lucide-loader-2"
      class="size-8 animate-spin text-muted"
    />
  </div>
</template>
