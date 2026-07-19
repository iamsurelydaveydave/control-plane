<script setup lang="ts">
/**
 * Databases page — following goweekdays-web CRUD pattern.
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
const { database, getAll, add, deleteById, reprovision, getCredentials } = useDatabase()
const { getAll: getServers } = useServer()

// Dialog state
const dialogAdd = ref(false)
const dialogPreview = ref(false)
const dialogEdit = ref(false)
const dialogDelete = ref(false)
const dialogCredentials = ref(false)
const loadingForm = ref(false)
const message = ref('')

// Credentials state
const credentials = ref<TDatabaseCredentials | null>(null)

// Search and pagination
const search = ref('')
const page = ref(1)

// Servers for the dropdown
const servers = ref<TServer[]>([])

// Table columns
const columns = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'type', header: 'Type' },
  { accessorKey: 'nodes', header: 'Nodes' },
  { accessorKey: 'status', header: 'Status' },
  { id: 'actions', header: '' }
]

// Data fetching with useLazyAsyncData
const { data, status, refresh } = await useLazyAsyncData(
  'databases',
  () => getAll({ page: page.value, search: search.value }),
  { immediate: true, watch: [page], server: false }
)

const loading = computed(() => status.value === 'pending')
const items = computed(() => data.value?.items ?? [])
const _pages = computed(() => data.value?.pages ?? 1)

// Fetch servers for the dropdown — only include servers that are ready for provisioning
async function fetchServers() {
  try {
    const result = await getServers()
    servers.value = (result.items || []).filter(
      (s: TServer) => s.status === 'online' && s.dockerInstalled
    )
  } catch {
    servers.value = []
  }
}

// Filtered items (client-side search for quick filtering)
const filteredItems = computed(() => {
  if (!search.value) return items.value
  const s = search.value.toLowerCase()
  return items.value.filter(
    (item: TDatabase) => item.name.toLowerCase().includes(s)
  )
})

// Central state setter — resets the resource, mode, message, and opens/closes the right dialog
function setItem({
  value = useDatabase().database.value,
  mode = '',
  dialog = false
} = {}) {
  Object.assign(database.value, JSON.parse(JSON.stringify({
    ...value,
    serverId: '',
    adminUser: 'admin',
    adminPassword: ''
  })))
  message.value = ''

  if (mode === 'add') dialogAdd.value = dialog
  if (mode === 'view') dialogPreview.value = dialog
  if (mode === 'edit') dialogEdit.value = dialog
  if (mode === 'delete') dialogDelete.value = dialog
}

function handleRowClick(_e: Event, row: { original: TDatabase }) {
  navigateTo(`/dashboard/databases/${row.original._id}`)
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
  const dbValue = database.value as TDatabase & { serverId?: string, adminUser?: string, adminPassword?: string }

  if (!dbValue.serverId) {
    message.value = 'Please select a server'
    return
  }

  loadingForm.value = true
  message.value = ''
  try {
    await add({
      name: dbValue.name,
      type: dbValue.type,
      version: dbValue.version,
      serverId: dbValue.serverId,
      adminUser: dbValue.adminUser || 'admin',
      adminPassword: dbValue.adminPassword || '',
      nodes: [{ serverId: dbValue.serverId, role: 'standalone' }]
    })
    toast.add({
      title: 'Database created',
      description: 'Provisioning has started. This may take a few minutes.',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    setItem({ mode: 'add' })
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to create database.'
  } finally {
    loadingForm.value = false
  }
}

async function submitDelete() {
  loadingForm.value = true
  message.value = ''
  try {
    await deleteById(database.value._id)
    toast.add({
      title: 'Database deleted',
      color: 'success',
      icon: 'i-lucide-check-circle'
    })
    await refresh()
    setItem({ mode: 'view' })
    dialogDelete.value = false
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    message.value = err?.data?.message ?? 'Failed to delete database.'
  } finally {
    loadingForm.value = false
  }
}

async function handleReprovision() {
  loadingForm.value = true
  try {
    await reprovision(database.value._id)
    toast.add({
      title: 'Reprovisioning started',
      description: 'The database is being reprovisioned.',
      color: 'info',
      icon: 'i-lucide-refresh-cw'
    })
    dialogPreview.value = false
    await refresh()
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Reprovision failed',
      description: err?.data?.message ?? 'Failed to reprovision database.',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  } finally {
    loadingForm.value = false
  }
}

async function handleViewCredentials() {
  try {
    const result = await getCredentials(database.value._id)
    credentials.value = result.credentials
    dialogCredentials.value = true
  } catch (error: unknown) {
    const err = error as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err?.data?.message ?? 'Failed to fetch credentials.',
      color: 'error',
      icon: 'i-lucide-circle-alert'
    })
  }
}

// Copy to clipboard
function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.add({
    title: 'Copied to clipboard',
    color: 'success',
    icon: 'i-lucide-check'
  })
}

// Get status color
function getStatusColor(status: string) {
  switch (status) {
    case 'running': return 'success'
    case 'provisioning': return 'warning'
    case 'failed': return 'error'
    default: return 'neutral'
  }
}

// Get type icon
function getTypeIcon(type: string) {
  switch (type) {
    case 'mongodb': return 'i-simple-icons-mongodb'
    case 'redis': return 'i-simple-icons-redis'
    case 'postgresql': return 'i-simple-icons-postgresql'
    case 'mysql': return 'i-simple-icons-mysql'
    default: return 'i-lucide-database'
  }
}

// Watch search and reset page
watch(search, () => {
  page.value = 1
  refresh()
})

onMounted(fetchServers)

useHead({ title: 'Databases · Control Plane' })
</script>

<template>
  <div>
    <div class="space-y-6">
      <div class="flex items-center justify-between">
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            Databases
          </h1>
          <p class="text-muted">
            Provision and manage your database clusters.
          </p>
        </div>
        <UButton
          icon="i-lucide-plus"
          label="Create Database"
          @click="setItem({ mode: 'add', dialog: true })"
        />
      </div>

      <div class="flex items-center gap-3">
        <UInput
          v-model="search"
          icon="i-lucide-search"
          placeholder="Search databases..."
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
                :name="getTypeIcon(row.original.type)"
                class="size-4 text-muted"
              />
              <span class="font-medium">{{ row.original.name }}</span>
            </div>
          </template>

          <template #type-cell="{ row }">
            <div class="flex items-center gap-1">
              <span class="capitalize">{{ row.original.type }}</span>
              <span class="text-muted text-xs">{{ row.original.version }}</span>
            </div>
          </template>

          <template #nodes-cell="{ row }">
            <span class="text-muted">{{ row.original.nodes?.length || 1 }} node{{ (row.original.nodes?.length || 1) > 1 ? 's' : '' }}</span>
          </template>

          <template #status-cell="{ row }">
            <div class="flex items-center gap-2">
              <UBadge
                :color="getStatusColor(row.original.status)"
                :label="row.original.status"
                variant="subtle"
              />
              <UIcon
                v-if="row.original.status === 'provisioning'"
                name="i-lucide-loader-2"
                class="size-4 animate-spin text-warning"
              />
            </div>
          </template>

          <template #actions-cell="{ row }">
            <UDropdownMenu
              :items="[
                [
                  { label: 'View Details', icon: 'i-lucide-eye', onSelect: () => navigateTo(`/dashboard/databases/${row.original._id}`) },
                  { label: 'View Credentials', icon: 'i-lucide-key', onSelect: async () => { setItem({ value: row.original }); await handleViewCredentials() }, disabled: row.original.status !== 'running' },
                  { label: 'Reprovision', icon: 'i-lucide-refresh-cw', onSelect: async () => { setItem({ value: row.original }); await handleReprovision() } }
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
                name="i-lucide-database"
                class="size-12 text-muted mb-4"
              />
              <p class="text-lg font-medium text-highlighted">
                No databases
              </p>
              <p class="text-sm text-muted mt-1">
                Create your first database cluster.
              </p>
              <UButton
                class="mt-4"
                icon="i-lucide-plus"
                label="Create Database"
                @click="setItem({ mode: 'add', dialog: true })"
              />
            </div>
          </template>
        </UTable>
      </div>
    </div>

    <!-- Add Database Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Create Database
        </h3>
      </template>

      <template #body>
        <DatabaseForm
          v-model:database="database"
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
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Database Details
        </h3>
      </template>

      <template #body>
        <DatabaseForm
          v-model:database="database"
          mode="view"
          @close="setItem({ mode: 'view' })"
          @edit="handleEdit(true)"
          @delete="setDeleteDialog(true)"
          @view-credentials="handleViewCredentials"
          @reprovision="handleReprovision"
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
        title="Delete Database"
        :content="`Are you sure you want to delete '${database.name}'? This will remove the deployment.`"
        action="Delete Database"
        color="error"
        :disabled="loadingForm"
        @cancel="setDeleteDialog(false)"
        @confirm="submitDelete"
      />
    </UModal>

    <!-- Credentials Modal -->
    <UModal
      v-model:open="dialogCredentials"
      class="max-w-md"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Database Credentials
        </h3>
      </template>

      <template #body>
        <div
          v-if="credentials"
          class="p-6 space-y-4"
        >
          <UFormField label="Admin User">
            <div class="flex gap-2">
              <UInput
                :model-value="credentials.adminUser"
                readonly
                class="flex-1"
              />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                @click="copyToClipboard(credentials.adminUser)"
              />
            </div>
          </UFormField>

          <UFormField label="Admin Password">
            <div class="flex gap-2">
              <UInput
                :model-value="credentials.adminPassword"
                type="password"
                readonly
                class="flex-1"
              />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                @click="copyToClipboard(credentials.adminPassword)"
              />
            </div>
          </UFormField>

          <UFormField label="Connection String">
            <div class="flex gap-2">
              <UInput
                :model-value="credentials.connectionString"
                readonly
                class="flex-1 font-mono text-xs"
              />
              <UButton
                icon="i-lucide-copy"
                color="neutral"
                variant="outline"
                @click="copyToClipboard(credentials.connectionString)"
              />
            </div>
          </UFormField>

          <UAlert
            color="warning"
            icon="i-lucide-alert-triangle"
            title="Keep these credentials safe"
            description="The admin password will not be shown again."
          />

          <div class="flex justify-end pt-2 border-t border-default">
            <UButton
              label="Close"
              color="neutral"
              variant="outline"
              @click="dialogCredentials = false"
            />
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
