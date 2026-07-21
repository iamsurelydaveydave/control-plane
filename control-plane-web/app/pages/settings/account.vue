<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { currentUser, logout, updateProfile } = useAuth()

// ---------------------------------------------------------------------------
// Update email
// ---------------------------------------------------------------------------
const emailForm = reactive({
  email: currentUser.value?.email ?? '',
  currentPassword: '',
})
const emailLoading = ref(false)

async function handleUpdateEmail() {
  if (emailLoading.value) return
  emailLoading.value = true
  try {
    await updateProfile({
      email: emailForm.email.trim(),
      currentPassword: emailForm.currentPassword,
    })
    toast.add({
      title: 'Email updated',
      description: `You are now signed in as ${emailForm.email}`,
      color: 'success',
      icon: 'i-lucide-check',
    })
    emailForm.currentPassword = ''
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Update failed',
      description: err?.data?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    emailLoading.value = false
  }
}

// ---------------------------------------------------------------------------
// Update password
// ---------------------------------------------------------------------------
const passwordForm = reactive({
  currentPassword: '',
  newPassword: '',
  confirmPassword: '',
})
const passwordLoading = ref(false)

async function handleUpdatePassword() {
  if (passwordLoading.value) return

  if (passwordForm.newPassword !== passwordForm.confirmPassword) {
    toast.add({ title: 'Passwords do not match', color: 'error' })
    return
  }
  if (passwordForm.newPassword.length < 8) {
    toast.add({ title: 'Password must be at least 8 characters', color: 'error' })
    return
  }

  passwordLoading.value = true
  try {
    await updateProfile({
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
      confirmPassword: passwordForm.confirmPassword,
    })
    toast.add({
      title: 'Password updated',
      color: 'success',
      icon: 'i-lucide-check',
    })
    passwordForm.currentPassword = ''
    passwordForm.newPassword = ''
    passwordForm.confirmPassword = ''
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Update failed',
      description: err?.data?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    passwordLoading.value = false
  }
}

useHead({ title: 'Account · Settings · Control Plane' })
</script>

<template>
  <div class="flex justify-center p-1">
    <div class="w-full max-w-2xl space-y-6">
      <!-- Header -->
      <div class="mb-2">
        <div class="flex items-center gap-2 mb-1">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/settings"
          />
          <h1 class="text-xl font-bold text-highlighted">
            Account
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Manage your login credentials.
        </p>
      </div>

      <!-- Profile -->
      <div class="rounded-lg border border-default bg-elevated p-6">
        <div class="flex items-center gap-4 mb-6">
          <UAvatar
            :alt="currentUser?.email"
            size="lg"
          />
          <div>
            <p class="font-medium text-highlighted">
              {{ currentUser?.email }}
            </p>
            <p class="text-sm text-muted capitalize">
              {{ currentUser?.role || 'Admin' }}
            </p>
          </div>
        </div>
      </div>

      <!-- Update email -->
      <div class="rounded-lg border border-default bg-elevated p-6 space-y-5">
        <div>
          <h2 class="font-semibold text-highlighted">
            Email address
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Change the email you use to sign in.
          </p>
        </div>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="New email" class="col-span-1">
            <UInput
              v-model="emailForm.email"
              type="email"
              placeholder="you@example.com"
              class="w-full"
              autocomplete="email"
            />
          </UFormField>

          <UFormField label="Current password" class="col-span-1">
            <UInput
              v-model="emailForm.currentPassword"
              type="password"
              placeholder="Confirm with your password"
              class="w-full"
              autocomplete="current-password"
            />
          </UFormField>
        </div>

        <div class="flex justify-end">
          <UButton
            icon="i-lucide-save"
            :loading="emailLoading"
            :disabled="!emailForm.email || !emailForm.currentPassword"
            @click="handleUpdateEmail"
          >
            Save email
          </UButton>
        </div>
      </div>

      <!-- Update password -->
      <div class="rounded-lg border border-default bg-elevated p-6 space-y-5">
        <div>
          <h2 class="font-semibold text-highlighted">
            Password
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Use a strong password of at least 8 characters.
          </p>
        </div>

        <UFormField label="Current password">
          <UInput
            v-model="passwordForm.currentPassword"
            type="password"
            placeholder="Enter your current password"
            class="w-full"
            autocomplete="current-password"
          />
        </UFormField>

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="New password" class="col-span-1">
            <UInput
              v-model="passwordForm.newPassword"
              type="password"
              placeholder="Min. 8 characters"
              class="w-full"
              autocomplete="new-password"
            />
          </UFormField>

          <UFormField label="Confirm new password" class="col-span-1">
            <UInput
              v-model="passwordForm.confirmPassword"
              type="password"
              placeholder="Repeat new password"
              class="w-full"
              autocomplete="new-password"
            />
          </UFormField>
        </div>

        <UAlert
          v-if="passwordForm.newPassword && passwordForm.confirmPassword && passwordForm.newPassword !== passwordForm.confirmPassword"
          color="error"
          variant="soft"
          icon="i-lucide-alert-circle"
          title="Passwords do not match"
        />

        <div class="flex justify-end">
          <UButton
            icon="i-lucide-lock"
            :loading="passwordLoading"
            :disabled="!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword"
            @click="handleUpdatePassword"
          >
            Update password
          </UButton>
        </div>
      </div>

      <!-- Danger zone -->
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
