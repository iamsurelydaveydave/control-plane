<template>
  <!-- Organization switcher dropdown for the sidebar -->
  <UDropdownMenu
    :items="menuItems"
    :content="{
      side: 'top',
      align: collapsed ? 'center' : 'start',
      sideOffset: 8
    }"
    :ui="{ content: 'w-64' }"
  >
    <UButton
      color="neutral"
      variant="ghost"
      square
      class="w-full overflow-hidden"
    >
      <div
        class="flex items-center justify-center size-6 rounded bg-primary/10 text-primary text-xs font-semibold shrink-0"
      >
        {{ orgInitial }}
      </div>
      <span
        v-if="!collapsed"
        class="truncate"
      >
        {{ currentOrganization?.name || 'Select Organization' }}
      </span>
      <UIcon
        v-if="!collapsed"
        name="i-lucide-chevrons-up-down"
        class="ms-auto size-4 shrink-0 text-dimmed"
      />
    </UButton>
  </UDropdownMenu>

  <!-- Create Organization Modal -->
  <UModal v-model:open="showCreateModal">
    <template #content>
      <div class="p-4 space-y-4">
        <h3 class="text-lg font-semibold">
          Create Organization
        </h3>
        <UFormField
          label="Name"
          name="name"
        >
          <UInput
            v-model="newOrgName"
            placeholder="My Organization"
            autofocus
          />
        </UFormField>
        <UFormField
          label="Slug"
          name="slug"
          hint="URL-friendly identifier (optional)"
        >
          <UInput
            v-model="newOrgSlug"
            :placeholder="suggestedSlug"
          />
        </UFormField>
      </div>
      <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 p-3">
        <UButton
          variant="ghost"
          class="flex-1"
          @click="showCreateModal = false"
        >
          Cancel
        </UButton>
        <UButton
          class="flex-1"
          :loading="creating"
          :disabled="!newOrgName.trim()"
          @click="handleCreate"
        >
          Create
        </UButton>
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
type DropdownMenuItem = {
  label: string
  type?: 'label'
  icon?: string
  to?: string
  onSelect?: () => void
}

defineProps<{ collapsed?: boolean }>()

const toast = useToast()
const { currentOrganization, organizations, getAll, select, create } = useOrganization()

// Modal state
const showCreateModal = ref(false)
const newOrgName = ref('')
const newOrgSlug = ref('')
const creating = ref(false)

// Computed
const orgInitial = computed(() => {
  return (currentOrganization.value?.name?.[0] ?? 'O').toUpperCase()
})

const suggestedSlug = computed(() => {
  return newOrgName.value
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50)
})

// Build menu items
const menuItems = computed((): DropdownMenuItem[][] => {
  const items: DropdownMenuItem[][] = []

  // Current org header if selected
  if (currentOrganization.value) {
    items.push([
      {
        label: currentOrganization.value.name,
        type: 'label' as const,
        icon: 'i-lucide-building-2'
      }
    ])
  }

  // Organization list
  if (organizations.value.length > 0) {
    const orgItems: DropdownMenuItem[] = organizations.value.map(org => ({
      label: org.name,
      icon: org._id === currentOrganization.value?._id
        ? 'i-lucide-check'
        : 'i-lucide-building',
      onSelect() {
        select(org)
      }
    }))
    items.push(orgItems)
  }

  // Actions
  items.push([
    {
      label: 'Create Organization',
      icon: 'i-lucide-plus',
      onSelect() {
        newOrgName.value = ''
        newOrgSlug.value = ''
        showCreateModal.value = true
      }
    }
  ])

  // Settings link (if org is selected)
  if (currentOrganization.value) {
    items.push([
      {
        label: 'Organization Settings',
        icon: 'i-lucide-settings',
        to: '/settings/organization'
      }
    ])
  }

  return items
})

// Actions
async function handleCreate() {
  if (!newOrgName.value.trim()) return

  creating.value = true
  try {
    const result = await create({
      name: newOrgName.value.trim(),
      slug: newOrgSlug.value.trim() || undefined
    })

    toast.add({
      title: 'Organization created',
      description: `${newOrgName.value} has been created successfully.`,
      color: 'success'
    })

    showCreateModal.value = false

    // Select the newly created org
    const newOrg = organizations.value.find(o => o._id === result.organizationId)
    if (newOrg) {
      await select(newOrg)
    }
  } catch (error: unknown) {
    const err = error as { data?: { error?: string } }
    toast.add({
      title: 'Error',
      description: err?.data?.error || 'Failed to create organization',
      color: 'error'
    })
  } finally {
    creating.value = false
  }
}

// Fetch organizations on mount
onMounted(async () => {
  if (organizations.value.length === 0) {
    try {
      await getAll()
    } catch {
      // Ignore - user might not have any orgs yet
    }
  }
})
</script>
