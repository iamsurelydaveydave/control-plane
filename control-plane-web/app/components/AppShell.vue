<script setup lang="ts">
/**
 * AppShell — the main application shell for Control Plane.
 */
import type { NavigationMenuItem } from '@nuxt/ui'

const _props = withDefaults(
  defineProps<{
    appName?: string
    navItems?: NavigationMenuItem[]
    homeTo?: string
  }>(),
  {
    appName: 'Control Plane',
    navItems: () => [],
    homeTo: '/'
  }
)

// Expanded (true) / collapsed (false) on desktop; opens the slide-over on mobile.
const open = useState('app-shell-open', () => true)
function toggleSidebar() {
  open.value = !open.value
}
</script>

<template>
  <div class="flex h-dvh bg-default text-default">
    <USidebar
      v-model:open="open"
      collapsible="icon"
      :ui="{ container: 'h-full', body: 'gap-2' }"
    >
      <!-- Header with collapse toggle -->
      <template #header="{ state }">
        <span
          v-if="state === 'expanded'"
          class="truncate text-lg font-bold text-highlighted"
        >
          {{ appName }}
        </span>
        <UButton
          v-if="state === 'expanded'"
          icon="i-lucide-panel-left-close"
          color="neutral"
          variant="ghost"
          square
          class="ms-auto"
          aria-label="Collapse sidebar"
          @click="toggleSidebar"
        />
      </template>

      <template #default="{ state }">
        <!-- Primary navigation -->
        <UNavigationMenu
          :key="state"
          :items="navItems"
          orientation="vertical"
          :ui="{ link: 'p-1.5 overflow-hidden' }"
        />
      </template>

      <!-- Account menu -->
      <template #footer="{ state }">
        <slot
          name="account"
          :collapsed="state === 'collapsed'"
        />
      </template>
    </USidebar>

    <main class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <!-- Mobile top bar -->
      <div class="flex h-14 shrink-0 items-center gap-2 border-b border-default px-3 lg:hidden">
        <UButton
          icon="i-lucide-panel-left"
          color="neutral"
          variant="ghost"
          aria-label="Open navigation"
          @click="toggleSidebar"
        />
        <span class="font-semibold text-highlighted">{{ appName }}</span>
      </div>

      <div class="min-h-0 flex-1 overflow-auto">
        <slot />
      </div>
    </main>
  </div>
</template>
