<template>
  <!-- `<UApp>` is required by @nuxt/ui for Toast, Tooltip and programmatic
       overlays, and the shared layouts assume it lives here — so it wraps
       every layout at the app root. -->
  <UApp>
    <NuxtLoadingIndicator />
    <NuxtLayout>
      <NuxtPage />
    </NuxtLayout>
  </UApp>
</template>
