<script setup lang="ts">
const { getActiveCount } = useAlerts()

// Fetch active alert count for badge
const { data: alertCountData, refresh: refreshAlertCount } = useLazyAsyncData(
  'alert-count',
  () => getActiveCount(),
  { immediate: true, server: false }
)

const activeAlertCount = computed(() => alertCountData.value?.count ?? 0)

// Refresh alert count periodically
let alertRefreshTimer: ReturnType<typeof setInterval> | null = null
onMounted(() => {
  alertRefreshTimer = setInterval(refreshAlertCount, 30000) // 30 seconds
})
onUnmounted(() => {
  if (alertRefreshTimer) clearInterval(alertRefreshTimer)
})

const navigationItems = computed(() => [
  {
    label: 'Dashboard',
    icon: 'i-lucide-layout-dashboard',
    to: '/dashboard'
  },
  {
    label: 'Monitoring',
    icon: 'i-lucide-activity',
    to: '/monitoring'
  },
  {
    label: 'Alerts',
    icon: 'i-lucide-bell',
    to: '/alerts',
    badge: activeAlertCount.value > 0 ? String(activeAlertCount.value) : undefined
  },
  {
    label: 'Logs',
    icon: 'i-lucide-scroll-text',
    to: '/logs'
  },
  {
    label: 'Nodes',
    icon: 'i-lucide-hard-drive',
    to: '/nodes'
  },
  {
    label: 'Apps',
    icon: 'i-lucide-box',
    to: '/apps'
  },
  {
    label: 'Resources',
    icon: 'i-lucide-puzzle',
    to: '/resources'
  },
  {
    label: 'Pipelines',
    icon: 'i-lucide-git-branch',
    to: '/pipelines'
  },
  {
    label: 'Registries',
    icon: 'i-lucide-container',
    to: '/registries'
  },
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: '/settings'
  }
])
</script>

<template>
  <AppShell
    app-name="Control Plane"
    :nav-items="navigationItems"
    home-to="/dashboard"
  >
    <template #account="{ collapsed }">
      <LayoutAccountMenu :collapsed="collapsed" />
    </template>

    <div class="p-6">
      <slot />
    </div>
  </AppShell>
</template>
