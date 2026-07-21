<script setup lang="ts">
/**
 * Container registries list page — manage Docker registries
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById, verifyCredentials, setDefault } = useRegistry()

// Search and pagination
const search = ref('')
const page = ref(1)

// Registry types
const registryTypes = [
  { value: 'dockerhub', label: 'Docker Hub' },
  { value: 'gcr', label: 'Google Container Registry' },
  { value: 'ecr', label: 'AWS ECR' },
  { value: 'acr', label: 'Azure Container Registry' },
  { value: 'ghcr', label: 'GitHub Container Registry' },
  { value: 'custom', label: 'Custom Registry' }
]

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'url', header: 'URL' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: '' }
]

// Data fetching
const { data, status, refresh } = await useLazyAsyncData(
  'registries',
  () => getAll({ page: page.value, search: search.value }),
  { immediate: true, watch: [page], server: false }
)

const loading = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])

// Filtered items
const filteredItems = computed(() => {
  if (!search.value) return items.value
  const s = search.value.toLowerCase()
  return items.value.filter(
    (item: TRegistry) =>
      item.name.toLowerCase().includes(s)
      || item.type.toLowerCase().includes(s)
      || item.url.toLowerCase().includes(s)
  )
})

// Add dialog
const dialogAdd = ref(false)
const loadingForm = ref(false)
const message = ref('')

const form = reactive<TRegistryForm>({
  name: '',
  type: 'dockerhub',
  url: '',
  username: '',
  password: '',
  isDefault: false
})

function openAdd() {
  Object.assign(form, {
    name: '',
    type: 'dockerhub',
    url: '',
    username: '',
    password: '',
    isDefault: false
  })
  message.value = ''
  dialogAdd.value = true
}

// Auto-fill URL based on type
watch(() => form.type, (type) => {
  const urlMap: Record<string, string> = {
    dockerhub: 'https://index.docker.io/v1/',
    gcr: 'https://gcr.io',
    ecr: '',
    acr: '',
    ghcr: 'https://ghcr.io',
    custom: ''
  }
  if (urlMap[type]) {
    form.url = urlMap[type]
  }
})

async function submitAdd() {
  if (!form.name || !form.url) {
    message.value = 'Name and URL are required.'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    await add(form)
    toast.add({
      title: 'Registry added',
      description: `${form.name} has been added successfully.`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    dialogAdd.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to add registry.'
  } finally {
    loadingForm.value = false
  }
}

// Delete dialog
const deleteTarget = ref<TRegistry | null>(null)
const dialogDelete = ref(false)
const deleting = ref(false)

function openDelete(registry: TRegistry) {
  deleteTarget.value = registry
  dialogDelete.value = true
}

async function submitDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await deleteById(deleteTarget.value._id)
    toast.add({
      title: `${deleteTarget.value.name} deleted`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    dialogDelete.value = false
    deleteTarget.value = null
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to delete registry',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

// Verify credentials
const verifyingId = ref<string | null>(null)

async function handleVerify(registry: TRegistry) {
  if (verifyingId.value) return
  verifyingId.value = registry._id
  try {
    const result = await verifyCredentials(registry._id)
    if (result.success) {
      toast.add({
        title: 'Credentials verified',
        description: `Successfully connected to ${registry.name}`,
        color: 'success',
        icon: 'i-lucide-check-circle'
      })
    } else {
      toast.add({
        title: 'Verification failed',
        description: result.error || 'Unable to connect to registry',
        color: 'error'
      })
    }
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Verification failed',
      color: 'error'
    })
  } finally {
    verifyingId.value = null
  }
}

// Set default
async function handleSetDefault(registry: TRegistry) {
  try {
    await setDefault(registry._id)
    toast.add({
      title: `${registry.name} set as default`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to set default',
      color: 'error'
    })
  }
}

// Status helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  verified: 'success',
  failed: 'error'
}

function getRegistryTypeLabel(type: TRegistryType): string {
  const found = registryTypes.find(t => t.value === type)
  return found?.label ?? type
}

// Watch search and reset page
watch(search, () => {
  page.value = 1
  refresh()
})

useHead({ title: 'Registries · Control Plane' })
</script>

<template>
  <div>
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            Container Registries
          </h1>
          <p class="text-muted">
            Manage container registries for image deployments.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Add Registry"
          @click="openAdd"
        />
      </div>

      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search registries..."
          class="w-64"
        />
        <UButton
          icon="i-lucide-refresh-cw"
          color="neutral"
          variant="ghost"
          :loading="loading"
          @click="() => refresh()"
        />
      </div>

      <div class="rounded-lg border border-default bg-elevated">
        <UTable
          :data="filteredItems"
          :columns="columns"
          :loading="loading"
        >
          <template #name-cell="{ row }">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-container"
                class="size-4 text-muted"
              />
              <span class="font-medium">{{ row.original.name }}</span>
              <UBadge
                v-if="row.original.isDefault"
                label="Default"
                color="primary"
                variant="soft"
                size="xs"
              />
            </div>
          </template>

          <template #type-cell="{ row }">
            <UBadge
              :label="getRegistryTypeLabel(row.original.type)"
              color="neutral"
              variant="subtle"
            />
          </template>

          <template #url-cell="{ row }">
            <code class="text-xs text-muted truncate max-w-48 block">
              {{ row.original.url }}
            </code>
          </template>

          <template #status-cell="{ row }">
            <div class="flex items-center gap-2">
              <UBadge
                :color="statusColor[row.original.status] || 'neutral'"
                :label="row.original.status"
                variant="subtle"
              />
              <UIcon
                v-if="verifyingId === row.original._id"
                name="i-lucide-loader-2"
                class="size-4 animate-spin text-muted"
              />
            </div>
          </template>

          <template #actions-cell="{ row }">
            <UDropdownMenu
              :items="[
                [
                  { label: 'Verify Credentials', icon: 'i-lucide-check-circle', onSelect: () => handleVerify(row.original) },
                  ...(row.original.isDefault ? [] : [{ label: 'Set as Default', icon: 'i-lucide-star', onSelect: () => handleSetDefault(row.original) }])
                ],
                [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => openDelete(row.original) }]
              ]"
            >
              <UButton
                icon="i-lucide-ellipsis"
                color="neutral"
                variant="ghost"
                @click.stop
              />
            </UDropdownMenu>
          </template>

          <template #empty>
            <div class="flex flex-col items-center justify-center py-12 text-center">
              <UIcon
                name="i-lucide-container"
                class="size-12 text-muted mb-4"
              />
              <p class="text-lg font-medium text-highlighted">
                No registries
              </p>
              <p class="text-sm text-muted mt-1">
                Add your first container registry.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-plus"
                label="Add Registry"
                @click="openAdd"
              />
            </div>
          </template>
        </UTable>
      </div>
    </div>

    <!-- Add Registry Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Add Container Registry
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <UAlert
            v-if="message"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            :title="message"
          />

          <UFormField label="Registry name">
            <UInput
              v-model="form.name"
              placeholder="my-registry"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Type">
            <USelect
              v-model="form.type"
              :items="registryTypes"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Registry URL">
            <UInput
              v-model="form.url"
              placeholder="https://registry.example.com"
              class="w-full"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Username">
              <UInput
                v-model="form.username"
                placeholder="username"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Password / Token">
              <UInput
                v-model="form.password"
                type="password"
                placeholder="••••••••"
                class="w-full"
              />
            </UFormField>
          </div>

          <UCheckbox
            v-model="form.isDefault"
            label="Set as default registry"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogAdd = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="loadingForm"
          :disabled="!form.name || !form.url"
          icon="i-lucide-plus"
          @click="submitAdd"
        >
          Add Registry
        </UButton>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="dialogDelete"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Delete Registry
        </h3>
      </template>

      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
              <UIcon
                name="i-lucide-alert-triangle"
                class="size-5 text-error"
              />
            </div>
            <div>
              <p class="text-muted">
                Are you sure you want to delete
                <span class="font-medium text-highlighted">{{ deleteTarget?.name }}</span>?
                Apps using this registry may fail to deploy.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogDelete = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleting"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Registry
        </UButton>
      </template>
    </UModal>
  </div>
</template>
