<script setup lang="ts">
/**
 * Apps list page — manage Kamal-based app deployments.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById, deploy, stop } = useApp()
const { getAll: getServers } = useServer()

// Dialog state
const dialogAdd = ref(false)
const dialogDelete = ref(false)
const loadingForm = ref(false)
const message = ref('')

// Search and pagination
const search = ref('')
const page = ref(1)

// Servers for the dropdown
const { data: serversData } = useLazyAsyncData(
  'servers-dropdown',
  () => getServers({ page: 1 }).catch(() => ({ items: [] as TServer[], pages: 0 })),
  { server: false }
)
const serverOptions = computed(() => {
  const servers = serversData.value?.items ?? []
  return servers
    .filter(s => s.status === 'online' && s.dockerInstalled)
    .map(s => ({ value: s._id, label: `${s.name} (${s.host})` }))
})

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'domain', header: 'Domain' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'currentVersion', header: 'Version' },
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
      || item.proxy?.host?.toLowerCase().includes(s)
  )
})

// Add form
const form = reactive<TAppForm>({
  name: '',
  source: { type: 'image', image: '' },
  serverIds: [],
  proxy: { ssl: true, host: '', appPort: 3000 }
})

function openAdd() {
  Object.assign(form, {
    name: '',
    source: { type: 'image', image: '' },
    serverIds: [],
    proxy: { ssl: true, host: '', appPort: 3000 }
  })
  message.value = ''
  dialogAdd.value = true
}

async function submitAdd() {
  if (!form.name || !form.serverIds.length) {
    message.value = 'Name and at least one server are required.'
    return
  }
  if (form.source.type === 'image' && !form.source.image) {
    message.value = 'Docker image is required.'
    return
  }
  if (form.source.type === 'git' && !form.source.gitUrl) {
    message.value = 'Git URL is required.'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    await add(form)
    toast.add({
      title: 'App created',
      description: `${form.name} has been created successfully.`,
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
            Deploy and manage your applications with Kamal.
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

          <template #domain-cell="{ row }">
            <span
              v-if="row.original.proxy?.host"
              class="text-sm text-muted font-mono"
            >
              {{ row.original.proxy.host }}
            </span>
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

          <template #currentVersion-cell="{ row }">
            <code
              v-if="row.original.currentVersion"
              class="text-xs text-muted bg-muted px-1.5 py-0.5 rounded"
            >
              {{ row.original.currentVersion }}
            </code>
            <span v-else class="text-sm text-muted">—</span>
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
          </UFormField>

          <UFormField label="Source type">
            <USelect
              v-model="form.source.type"
              :items="[
                { value: 'image', label: 'Docker Image' },
                { value: 'git', label: 'Git Repository' }
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="form.source.type === 'image'"
            label="Docker image"
          >
            <UInput
              v-model="form.source.image"
              placeholder="nginx:latest"
              class="w-full"
            />
          </UFormField>

          <template v-if="form.source.type === 'git'">
            <UFormField label="Git URL">
              <UInput
                v-model="form.source.gitUrl"
                placeholder="https://github.com/user/repo.git"
                class="w-full"
              />
            </UFormField>
            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Branch">
                <UInput
                  v-model="form.source.gitBranch"
                  placeholder="main"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Dockerfile">
                <UInput
                  v-model="form.source.dockerfile"
                  placeholder="Dockerfile"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Domain">
              <UInput
                v-model="form.proxy!.host"
                placeholder="app.example.com"
                class="w-full"
              />
            </UFormField>
            <UFormField label="App port">
              <UInput
                v-model.number="form.proxy!.appPort"
                type="number"
                placeholder="3000"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="Servers">
            <USelect
              v-model="form.serverIds"
              :items="serverOptions"
              multiple
              placeholder="Select servers..."
              class="w-full"
            />
            <template #hint>
              <span
                v-if="!serverOptions.length"
                class="text-xs text-muted"
              >
                No ready servers. Servers must be
                <span class="font-medium text-highlighted">online with Docker installed</span>.
                <NuxtLink
                  to="/dashboard/servers"
                  class="text-primary underline"
                >Set up a server</NuxtLink> first.
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
          :disabled="!form.name || !form.serverIds.length"
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
                This will remove the deployment and cannot be undone.
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
