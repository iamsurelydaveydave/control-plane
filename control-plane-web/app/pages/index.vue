<script setup lang="ts">
/**
 * Index page — redirects based on setup/auth status.
 */
definePageMeta({ layout: false })

const { checkStatus } = useSetup()
const { loggedInUser } = useAuth()

onMounted(async () => {
  try {
    const initialized = await checkStatus()
    if (!initialized) {
      navigateTo('/setup')
      return
    }

    // Check cookie hint — if present, go to dashboard
    if (loggedInUser()) {
      navigateTo('/dashboard')
    } else {
      navigateTo('/login')
    }
  } catch {
    navigateTo('/login')
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
