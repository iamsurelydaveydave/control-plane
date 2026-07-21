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
            to="/settings"
          />
          <h1 class="text-xl font-bold text-highlighted">
            Appearance
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Customize how the control plane looks.
        </p>
      </div>

      <!-- Theme Card -->
      <div class="rounded-lg border border-default bg-elevated p-6 mb-4">
        <h2 class="font-semibold text-highlighted mb-4">
          Theme
        </h2>
        <UFormField label="Color mode">
          <USelect
            v-model="colorMode.preference"
            :items="themes"
            class="w-48"
          />
          <template #hint>
            <span class="text-xs text-muted">Choose between light, dark, or system theme.</span>
          </template>
        </UFormField>
      </div>

      <!-- About Card -->
      <div class="rounded-lg border border-default bg-elevated p-6">
        <h2 class="font-semibold text-highlighted mb-4">
          About
        </h2>
        <div class="flex items-center gap-3">
          <span class="flex size-10 items-center justify-center rounded-lg bg-primary text-inverted">
            <UIcon
              name="i-lucide-server"
              class="size-5"
            />
          </span>
          <div>
            <p class="font-semibold text-highlighted">
              Control Plane
            </p>
            <p class="text-sm text-muted">
              v0.1.0
            </p>
          </div>
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

const colorMode = useColorMode()

const themes = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' }
]

useHead({ title: 'Appearance · Settings · Control Plane' })
</script>
