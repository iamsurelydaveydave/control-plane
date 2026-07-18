<template>
  <!-- Account menu for the sidebar footer -->
  <UDropdownMenu
    :items="menuItems"
    :content="{
      side: 'top',
      align: collapsed ? 'center' : 'start',
      sideOffset: 8
    }"
    :ui="{ content: 'w-56' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      square
      class="w-full overflow-hidden"
    >
      <UAvatar
        :alt="name"
        :text="initials"
        size="xs"
      />
      <span
        v-if="!collapsed"
        class="truncate"
      >
        {{ name || 'Account' }}
      </span>
      <UIcon
        v-if="!collapsed"
        name="i-lucide-chevrons-up-down"
        class="ms-auto size-4 shrink-0 text-dimmed"
      />
    </UButton>
  </UDropdownMenu>
</template>

<script setup lang="ts">
defineProps<{ collapsed?: boolean }>()

const { currentUser, logout } = useAuth()
const colorMode = useColorMode()

const isDark = computed(() => colorMode.value === 'dark')

const name = computed(() => {
  return currentUser.value?.email?.split('@')[0] || 'Admin'
})

const initials = computed(() => {
  return (currentUser.value?.email?.[0] ?? 'A').toUpperCase()
})

const menuItems = computed(() => [
  ...(currentUser.value?.email
    ? [[{ label: currentUser.value.email, type: 'label' as const }]]
    : []),
  [
    {
      label: isDark.value ? 'Light mode' : 'Dark mode',
      icon: isDark.value ? 'i-lucide-sun' : 'i-lucide-moon',
      onSelect(e: Event) {
        e.preventDefault()
        colorMode.preference = isDark.value ? 'light' : 'dark'
      }
    }
  ],
  [
    {
      label: 'Sign out',
      icon: 'i-lucide-log-out',
      color: 'error' as const,
      onSelect() {
        logout()
      }
    }
  ]
])
</script>
