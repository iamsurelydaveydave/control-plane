<template>
  <div class="grid min-h-dvh lg:grid-cols-2">
    <!-- ===================== FORM SIDE ===================== -->
    <div class="flex items-center justify-center p-6 sm:p-10">
      <div class="w-full max-w-sm">
        <!-- Brand -->
        <div class="inline-flex items-center gap-2.5">
          <span class="flex size-9 items-center justify-center rounded-lg bg-primary text-inverted">
            <UIcon
              name="i-lucide-cloud"
              class="size-5"
            />
          </span>
          <span class="text-xl font-bold tracking-tight text-highlighted">
            Control Plane
          </span>
        </div>

        <h1 class="mt-8 text-2xl font-bold tracking-tight text-highlighted">
          Welcome to Control Plane
        </h1>
        <p class="mt-1 text-muted">
          Create your admin account to get started.
        </p>

        <UForm
          :state="state"
          :validate="validate"
          class="mt-8 space-y-4"
          @submit="onSubmit"
        >
          <UFormField
            label="Admin Email"
            name="email"
            required
          >
            <UInput
              v-model="state.email"
              type="email"
              autocomplete="email"
              placeholder="admin@example.com"
              icon="i-lucide-mail"
              class="w-full"
              :disabled="loading"
            />
          </UFormField>

          <UFormField
            label="Password"
            name="password"
            hint="At least 8 characters"
            required
          >
            <UInput
              v-model="state.password"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Create a password"
              icon="i-lucide-lock"
              class="w-full"
              :disabled="loading"
              :ui="{ trailing: 'pe-1' }"
            >
              <template #trailing>
                <UButton
                  color="neutral"
                  variant="link"
                  size="sm"
                  :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  tabindex="-1"
                  @click="showPassword = !showPassword"
                />
              </template>
            </UInput>
          </UFormField>

          <UFormField
            label="Confirm Password"
            name="confirmPassword"
            required
          >
            <UInput
              v-model="state.confirmPassword"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="new-password"
              placeholder="Confirm your password"
              icon="i-lucide-lock"
              class="w-full"
              :disabled="loading"
            />
          </UFormField>

          <UAlert
            v-if="message"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            :description="message"
          />

          <UButton
            type="submit"
            block
            :loading="loading"
            label="Create Admin Account"
            icon="i-lucide-user-plus"
            trailing
          />
        </UForm>

        <p class="mt-6 text-center text-sm text-muted">
          This will be the only admin account. You can add more users later.
        </p>
      </div>
    </div>

    <!-- ===================== BRAND SIDE ===================== -->
    <div class="relative hidden overflow-hidden bg-primary text-white dark:text-black p-12 lg:flex lg:flex-col lg:justify-center">
      <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(70%_50%_at_80%_0%,rgba(255,255,255,0.18),transparent_70%)]" />
      <div class="relative z-10 max-w-lg">
        <p class="text-xs font-semibold uppercase tracking-[0.18em]">
          Control Plane
        </p>
        <h2 class="mt-6 text-4xl font-bold leading-tight tracking-tight">
          Self-hosted infrastructure management.
          <span>Deploy apps. Provision databases. Manage servers.</span>
        </h2>
        <p class="mt-6 text-lg leading-relaxed">
          Like Coolify, but with scaling as a first-class feature. One Docker image, one curl command, works anywhere.
        </p>
        <ul class="mt-10 space-y-4">
          <li
            v-for="point in highlights"
            :key="point"
            class="flex items-center gap-3"
          >
            <UIcon
              name="i-lucide-circle-check"
              class="size-5 shrink-0"
            />
            <span>{{ point }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'default' })

const { checkStatus, initialize } = useSetup()
const toast = useToast()

const highlights = [
  'Deploy Docker containers to your servers',
  'Scale to N replicas across M servers',
  'Production-grade MongoDB, Redis, PostgreSQL',
  'Self-healing with automatic recovery'
]

const state = reactive({ email: '', password: '', confirmPassword: '' })
const showPassword = ref(false)
const loading = ref(false)
const message = ref('')

type FieldError = { name: string, message: string }

function validate(s: typeof state): FieldError[] {
  const errors: FieldError[] = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!s.email) errors.push({ name: 'email', message: 'Required' })
  else if (!emailRegex.test(s.email)) {
    errors.push({ name: 'email', message: 'Please enter a valid email address' })
  }

  if (!s.password) errors.push({ name: 'password', message: 'Required' })
  else if (s.password.length < 8) {
    errors.push({ name: 'password', message: 'Password must be at least 8 characters' })
  }

  if (!s.confirmPassword) errors.push({ name: 'confirmPassword', message: 'Required' })
  else if (s.password !== s.confirmPassword) {
    errors.push({ name: 'confirmPassword', message: 'Passwords do not match' })
  }

  return errors
}

async function onSubmit() {
  loading.value = true
  message.value = ''

  try {
    await initialize(state.email, state.password)
    toast.add({
      title: 'Setup complete!',
      description: 'You can now sign in with your admin account.',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await navigateTo('/login')
  } catch (error: unknown) {
    const err = error as { response?: { _data?: { message?: string } }, message?: string }
    message.value = err?.response?._data?.message || err?.message || 'An unexpected error occurred. Please try again.'
  } finally {
    loading.value = false
  }
}

// Check if already initialized
onMounted(async () => {
  try {
    const initialized = await checkStatus()
    if (initialized) {
      navigateTo('/login')
    }
  } catch {
    // API not available, stay on setup page
  }
})

useHead({ title: 'Setup · Control Plane' })
</script>
