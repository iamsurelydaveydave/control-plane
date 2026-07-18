<script setup lang="ts">
/**
 * Apps page — following goweekdays-web CRUD pattern.
 *
 * Uses a single setItem() function to manage dialog state, resource reset, and mode transitions.
 * Uses useLazyAsyncData for data fetching with proper loading states.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { app, getAll, add, deleteById, deploy } = useApp()
const { getAll: getServers } = useServer()

// Dialog state
const dialogAdd = ref(false)
const dialogPreview = ref(false)
const dialogEdit = ref(false)
const dialogDelete = ref(false)
const loadingForm = ref(false)
const message = ref('')

// Search and pagination
const search = ref('')
const page = ref(1)

// Servers for the dropdown
const servers = ref<TServer[]>([])

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'image', header: 'Image' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'desiredReplicas', header: 'Replicas' },
  { id: 'actions', header: '' }
]

// Data fetching with useLazyAsyncData
const { data, status, refresh } = await useLazyAsyncData(
  'apps',
  () => getAll({ page: page.value, search: search.value }),
  { immediate: true, watch: [page] }
)

const loading = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])
const _pages = computed(() => data.value?.pages ?? 1)

// Filtered items (client-side search for quick filtering)
const filteredItems = computed(() => {
  if (!search.value) return items.value
  const s = search.value.toLowerCase()
  return items.value.filter(
    (item: TApp) =>
      item.name.toLowerCase().includes(s)
      || item.image.toLowerCase().includes(s)
  )
})

// Central state setter — resets the resource, mode, message, and opens/closes the right dialog
function setItem({
  value = useApp().app.value,
  mode = '',
  dialog = false
} = {}) {
  Object.assign(app.value, JSON.parse(JSON.stringify({
    ...value,
    serverIds: value.serverIds ?? []
  })))
  message.value = ''

  if (mode === 'add') dialogAdd.value = dialog
  if (mode === 'view') dialogPreview.value = dialog
  if (mode === 'edit') dialogEdit.value = dialog
  if (mode === 'delete') dialogDelete.value = dialog
}

function handleRowClick(_e: Event, row: { original: TApp }) {
  setItem({ value: row.original, mode: 'view', dialog: true })
}

function handleEdit(openDialog = false) {
  if (openDialog) dialogPreview.value = false
  dialogEdit.value = openDialog
}

function setDeleteDialog(value = false) {
  if (value) setItem({ mode: 'view' })
  dialogDelete.value = value
}

// CRUD submit functions
async function submitAdd() {
  const appValue = app.value as TApp & { serverIds?: string[] }

  if (!appValue.serverIds?.length) {
    message.value = 'Please select at least one server'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    await add({
      name: appValue.name,
      image: appValue.image,
      desiredReplicas: appValue.desiredReplicas,
      serverIds: appValue.serverIds
    })
    toast.add({
      title: 'App created',
      description: 'The app has been created successfully.',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    setItem({ mode: 'add' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to create app.'
  } finally {
    loadingForm.value = false
  }
}

async function submitEdit() {
  loadingForm.value = true
  message.value = ''
  try {
    toast.add({
      title: 'App updated',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
    setItem({ mode: 'edit' })
    dialogEdit.value = false
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to update app.'
  } finally {
    loadingForm.value = false
  }
}

async function submitDelete() {
  loadingForm.value = true
  message.value = ''
  try {
    await deleteById(app.value._id)
    toast.add({
      title: 'App deleted',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
    setItem({ mode: 'view' })
    dialogDelete.value = false
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to delete app.'
  } finally {
    loadingForm.value = false
  }
}

async function handleDeploy() {
  loadingForm.value = true
  try {
    await deploy(app.value._id)
    toast.add({
      title: 'Deployment started',
      description: `Deploying ${app.value.name}...`,
      color: 'info',
      icon: 'i-lucide-rocket'
    })
    dialogPreview.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Deployment failed',
      description: err?.data?.message ?? 'Failed to start deployment.',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    loadingForm.value = false
  }
}

// Get status color
function getStatusColor(status: string) {
  switch (status) {
    case 'running': return 'success'
    case 'deploying': return 'warning'
    case 'failed': return 'error'
    default: return 'neutral'
  }
}

// Watch search and reset page
watch(search, () => {
  page.value = 1
  refresh()
})

// Fetch servers for the dropdown
async function fetchServers() {
  try {
    const result = await getServers()
    servers.value = result.items || []
  } catch {
    servers.value = []
  }
}

onMounted(fetchServers)

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
            Deploy and manage your applications.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Create App"
          @click="setItem({ mode: 'add', dialog: true })"
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
            <code class="text-sm text-muted bg-muted px-1.5 py-0.5 rounded">
              {{ row.original.image }}
            </code>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              :color="getStatusColor(row.original.status)"
              :label="row.original.status"
              variant="subtle"
            />
          </template>

          <template #actions-cell="{ row }">
            <UDropdownMenu
              :items="[
                [
                  { label: 'View', icon: 'i-lucide-eye', onSelect: () => setItem({ value: row.original, mode: 'view', dialog: true }) },
                  { label: 'Deploy', icon: 'i-lucide-rocket', onSelect: async () => { setItem({ value: row.original }); await handleDeploy() } }
                ],
                [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => { setItem({ value: row.original }); setDeleteDialog(true) } }]
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
                Create your first app to deploy.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-plus"
                label="Create App"
                @click="setItem({ mode: 'add', dialog: true })"
              />
            </div>
          </template>
        </UTable>
      </div>
    </div>

    <!-- Add App Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-md"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Create App
        </h3>
      </template>

      <template #body>
        <AppForm
          v-model:app="app"
          v-model:message="message"
          mode="add"
          :loading="loadingForm"
          :servers="servers"
          @close="setItem({ mode: 'add' })"
          @submit="submitAdd"
        />
      </template>
    </UModal>

    <!-- Preview/View Modal -->
    <UModal
      v-model:open="dialogPreview"
      class="max-w-md"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          App Details
        </h3>
      </template>

      <template #body>
        <AppForm
          v-model:app="app"
          mode="view"
          @close="setItem({ mode: 'view' })"
          @edit="handleEdit(true)"
          @delete="setDeleteDialog(true)"
          @deploy="handleDeploy"
        />
      </template>
    </UModal>

    <!-- Edit Modal -->
    <UModal
      v-model:open="dialogEdit"
      class="max-w-md"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Edit App
        </h3>
      </template>

      <template #body>
        <AppForm
          v-model:app="app"
          v-model:message="message"
          mode="edit"
          :loading="loadingForm"
          :servers="servers"
          @close="setItem({ mode: 'edit' })"
          @submit="submitEdit"
        />
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model:open="dialogDelete"
      class="max-w-sm"
    >
      <ConfirmationPrompt
        v-model:message="message"
        title="Delete App"
        :content="`Are you sure you want to delete '${app.name}'?`"
        action="Delete App"
        color="error"
        :disabled="loadingForm"
        @cancel="setDeleteDialog(false)"
        @confirm="submitDelete"
      />
    </UModal>
  </div>
</template>
