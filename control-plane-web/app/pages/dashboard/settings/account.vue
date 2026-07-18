<template>
  <div class="flex justify-center p-1">
    <div class="w-full max-w-4xl">
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-1">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/dashboard/settings"
          />
          <h1 class="text-xl font-bold text-highlighted">
            Account
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Manage your account settings.
        </p>
      </div>

      <!-- Account Info Card -->
      <div class="rounded-lg border border-default bg-elevated p-6 mb-4">
        <h2 class="font-semibold text-highlighted mb-4">
          Profile
        </h2>
        <div class="space-y-4">
          <div class="flex items-center gap-4">
            <UAvatar
              :alt="currentUser?.email"
              size="lg"
            />
            <div>
              <p class="font-medium text-highlighted">
                {{ currentUser?.email }}
              </p>
              <p class="text-sm text-muted capitalize">
                {{ currentUser?.role || 'User' }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- Danger Zone -->
      <div class="rounded-lg border border-error/30 bg-error/5 p-6">
        <h2 class="font-semibold text-error mb-4">
          Danger Zone
        </h2>
        <div class="flex items-center justify-between">
          <div>
            <p class="font-medium text-highlighted">
              Sign out
            </p>
            <p class="text-sm text-muted">
              Sign out of your account on this device.
            </p>
          </div>
          <UButton
            color="error"
            variant="soft"
            icon="i-lucide-log-out"
            @click="logout"
          >
            Sign out
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { currentUser, logout } = useAuth()

useHead({ title: 'Account · Settings · Control Plane' })
</script>
