<script setup lang="ts">
/**
 * Apps list page — manage Kubernetes app deployments.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById, deploy, stop } = useApp()

// Dialog state
const dialogAdd = ref(false)
const dialogDelete = ref(false)
const loadingForm = ref(false)
const message = ref('')

// Search and pagination
const search = ref('')
const page = ref(1)

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'image', header: 'Image' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'replicas', header: 'Replicas' },
  { accessorKey: 'deployedAt', header: 'Last Deploy' },
  { id: 'actions', header: '' }
]

// Data fetching with useLazyAsyncData
const { data, status, refresh } = await useLazyAsyncData(
  'apps',
  () => getAll({ page: page.value, search: search.value }),
  { immediate: true, watch: [page], server: false }
)

const loading = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])

// Filtered items (client-side search for quick filtering)
const filteredItems = computed(() => {
  if (!search.value) return items.value
  const s = search.value.toLowerCase()
  return items.value.filter(
    (item: TApp) =>
      item.name.toLowerCase().includes(s)
      || item.source?.image?.toLowerCase().includes(s)
      || item.proxy?.host?.toLowerCase().includes(s)
  )
})

// Add form
const form = reactive({
  name: '',
  source: { type: 'image' as const, image: '' },
  k8s: { replicas: 1, port: 3000 },
  proxy: { ssl: true, host: '', port: 3000 }
})

function openAdd() {
  Object.assign(form, {
    name: '',
    source: { type: 'image', image: '' },
    k8s: { replicas: 1, port: 3000 },
    proxy: { ssl: true, host: '', port: 3000 }
  })
  message.value = ''
  dialogAdd.value = true
}

async function submitAdd() {
  if (!form.name) {
    message.value = 'Name is required.'
    return
  }
  if (!form.source.image) {
    message.value = 'Docker image is required.'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    await add({
      name: form.name,
      source: form.source,
      k8s: {
        replicas: form.k8s.replicas,
        image: form.source.image,
        port: form.k8s.port,
        domain: form.proxy.host || undefined,
        envVars: {}
      },
      proxy: form.proxy.host ? form.proxy : undefined
    })
    toast.add({
      title: 'App created',
      description: `${form.name} has been created and will be deployed.`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    dialogAdd.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to create app.'
  } finally {
    loadingForm.value = false
  }
}

// Delete dialog
const deleteTarget = ref<TApp | null>(null)
const deleting = ref(false)

function openDelete(app: TApp) {
  deleteTarget.value = app
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
      title: err?.data?.message || 'Failed to delete app',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

// Quick actions
async function handleDeploy(app: TApp) {
  try {
    await deploy(app._id)
    toast.add({
      title: 'Deployment started',
      description: `Deploying ${app.name}...`,
      color: 'info',
      icon: 'i-lucide-rocket'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Deployment failed',
      description: err?.data?.message ?? 'Failed to start deployment.',
      color: 'error'
    })
  }
}

async function handleStop(app: TApp) {
  try {
    await stop(app._id)
    toast.add({
      title: `${app.name} stopped`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to stop app',
      color: 'error'
    })
  }
}

function handleRowClick(_e: Event, row: { original: TApp }) {
  navigateTo(`/dashboard/apps/${row.original._id}`)
}

// Status helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  deploying: 'warning',
  running: 'success',
  stopped: 'neutral',
  failed: 'error'
}

function formatDate(date?: string) {
  if (!date) return '—'
  return new Date(date).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

// Watch search and reset page
watch(search, () => {
  page.value = 1
  refresh()
})

useHead({ title: 'Apps · Control Plane' })
</script>

<template>
  <div>
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            Apps
          </h1>
          <p class="text-muted">
            Deploy and manage containerized applications on Kubernetes.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Create App"
          @click="openAdd"
        />
      </div>

      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search apps..."
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
          @select="handleRowClick"
        >
          <template #name-cell="{ row }">
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-box"
                class="size-4 text-muted"
              />
              <span class="font-medium">{{ row.original.name }}</span>
            </div>
          </template>

          <template #image-cell="{ row }">
            <code
              v-if="row.original.source?.image || row.original.currentImage"
              class="text-xs text-muted bg-muted px-1.5 py-0.5 rounded font-mono truncate max-w-48 block"
            >
              {{ row.original.source?.image || row.original.currentImage }}
            </code>
            <span v-else class="text-sm text-muted">—</span>
          </template>

          <template #status-cell="{ row }">
            <div class="flex items-center gap-2">
              <UBadge
                :color="statusColor[row.original.status] || 'neutral'"
                :label="row.original.status"
                variant="subtle"
              />
              <UIcon
                v-if="row.original.status === 'deploying'"
                name="i-lucide-loader-2"
                class="size-4 animate-spin text-warning"
              />
            </div>
          </template>

          <template #replicas-cell="{ row }">
            <span class="text-sm text-muted">
              {{ row.original.desiredReplicas ?? row.original.k8s?.replicas ?? 1 }}
            </span>
          </template>

          <template #deployedAt-cell="{ row }">
            <span class="text-sm text-muted">
              {{ formatDate(row.original.deployedAt) }}
            </span>
          </template>

          <template #actions-cell="{ row }">
            <UDropdownMenu
              :items="[
                [
                  { label: 'View Details', icon: 'i-lucide-eye', onSelect: () => navigateTo(`/dashboard/apps/${row.original._id}`) },
                  { label: 'Deploy', icon: 'i-lucide-rocket', onSelect: () => handleDeploy(row.original) },
                  { label: 'Stop', icon: 'i-lucide-square', onSelect: () => handleStop(row.original), disabled: row.original.status !== 'running' }
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
                name="i-lucide-box"
                class="size-12 text-muted mb-4"
              />
              <p class="text-lg font-medium text-highlighted">
                No apps
              </p>
              <p class="text-sm text-muted mt-1">
                Create your first app to start deploying.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-plus"
                label="Create App"
                @click="openAdd"
              />
            </div>
          </template>
        </UTable>
      </div>
    </div>

    <!-- Create App Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Create App
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

          <UFormField label="App name">
            <UInput
              v-model="form.name"
              placeholder="my-app"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                Lowercase letters, numbers, and hyphens only.
              </span>
            </template>
          </UFormField>

          <UFormField label="Docker image">
            <UInput
              v-model="form.source.image"
              placeholder="nginx:latest or ghcr.io/user/app:v1.0"
              class="w-full"
            />
          </UFormField>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Replicas">
              <UInput
                v-model.number="form.k8s.replicas"
                type="number"
                min="0"
                max="10"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Container port">
              <UInput
                v-model.number="form.k8s.port"
                type="number"
                placeholder="3000"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Domain (optional)">
            <UInput
              v-model="form.proxy.host"
              placeholder="app.example.com"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                Leave empty for cluster-internal only.
              </span>
            </template>
          </UFormField>
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
          :disabled="!form.name || !form.source.image"
          icon="i-lucide-plus"
          @click="submitAdd"
        >
          Create App
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
          Delete App
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
                This will remove all K8s resources and cannot be undone.
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
          Delete App
        </UButton>
      </template>
    </UModal>
  </div>
</template>
