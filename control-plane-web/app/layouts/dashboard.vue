<script setup lang="ts">
const navigationItems = [
  {
    label: 'Dashboard',
    icon: 'i-lucide-layout-dashboard',
    to: '/dashboard'
  },
  {
    label: 'Servers',
    icon: 'i-lucide-server',
    to: '/dashboard/servers'
  },
  {
    label: 'Apps',
    icon: 'i-lucide-box',
    to: '/dashboard/apps'
  },
  {
    label: 'Databases',
    icon: 'i-lucide-database',
    to: '/dashboard/databases'
  },
  {
    label: 'Settings',
    icon: 'i-lucide-settings',
    to: '/dashboard/settings'
  }
]
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
