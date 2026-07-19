<script setup lang="ts">
/**
 * Database detail page — view database info, manage nodes, view health.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const route = useRoute()
const router = useRouter()
const toast = useToast()
const databaseId = route.params.id as string

const {
  getById,
  getCredentials,
  getHealth,
  addNode,
  removeNode,
  reprovision,
  deleteById
} = useDatabase()
const { getAll: getServers } = useServer()

// Fetch database
const { data: databaseData, status, refresh } = await useLazyAsyncData(
  `database-${databaseId}`,
  () => getById(databaseId),
  { immediate: true }
)
const database = computed(() => databaseData.value?.database)
const loading = computed(() => status.value === 'pending')

// Fetch servers for add node dropdown
const { data: serversData } = await useLazyAsyncData(
  'servers-for-nodes',
  () => getServers({ page: 1 }).catch(() => ({ items: [] }))
)
const availableServers = computed(() => {
  const allServers = serversData.value?.items ?? []
  const usedServerIds = database.value?.nodes?.map(n => n.serverId) ?? []
  return allServers.filter(s => !usedServerIds.includes(s._id) && s.status === 'online')
})

// Health check
const health = ref<TDatabaseHealth | null>(null)
const healthLoading = ref(false)

async function fetchHealth() {
  if (!database.value || database.value.status !== 'running') return
  healthLoading.value = true
  try {
    health.value = await getHealth(databaseId)
  } catch {
    health.value = null
  } finally {
    healthLoading.value = false
  }
}

// Credentials
const credentials = ref<TDatabaseCredentials | null>(null)
const credentialsOpen = ref(false)
const credentialsLoading = ref(false)

async function handleViewCredentials() {
  credentialsLoading.value = true
  try {
    const result = await getCredentials(databaseId)
    credentials.value = result.credentials
    credentialsOpen.value = true
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Error',
      description: err?.data?.message || 'Failed to fetch credentials',
      color: 'error'
    })
  } finally {
    credentialsLoading.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied to clipboard', color: 'success', icon: 'i-lucide-check' })
}

// Add node dialog
const addNodeOpen = ref(false)
const addNodeForm = reactive({
  serverId: '',
  role: 'secondary' as 'secondary' | 'arbiter'
})
const addNodeLoading = ref(false)

function openAddNode() {
  addNodeForm.serverId = ''
  addNodeForm.role = 'secondary'
  addNodeOpen.value = true
}

async function submitAddNode() {
  if (!addNodeForm.serverId || addNodeLoading.value) return
  addNodeLoading.value = true
  try {
    await addNode(databaseId, addNodeForm.serverId, addNodeForm.role)
    toast.add({
      title: 'Node addition started',
      description: 'The node is being provisioned. This may take a few minutes.',
      color: 'success',
      icon: 'i-lucide-check'
    })
    addNodeOpen.value = false
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to add node',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    addNodeLoading.value = false
  }
}

// Remove node
const removeNodeTarget = ref<TDatabaseNode | null>(null)
const removeNodeOpen = ref(false)
const removeNodeLoading = ref(false)

function openRemoveNode(node: TDatabaseNode) {
  removeNodeTarget.value = node
  removeNodeOpen.value = true
}

async function submitRemoveNode() {
  if (!removeNodeTarget.value || removeNodeLoading.value) return
  removeNodeLoading.value = true
  try {
    await removeNode(databaseId, removeNodeTarget.value.serverId)
    toast.add({
      title: 'Node removal started',
      description: 'The node is being removed from the cluster.',
      color: 'success',
      icon: 'i-lucide-check'
    })
    removeNodeOpen.value = false
    removeNodeTarget.value = null
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to remove node',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    removeNodeLoading.value = false
  }
}

// Reprovision
const reprovisionLoading = ref(false)

async function handleReprovision() {
  reprovisionLoading.value = true
  try {
    await reprovision(databaseId)
    toast.add({
      title: 'Reprovisioning started',
      color: 'info',
      icon: 'i-lucide-refresh-cw'
    })
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Reprovision failed',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    reprovisionLoading.value = false
  }
}

// Delete
const deleteOpen = ref(false)
const deleteLoading = ref(false)

async function submitDelete() {
  deleteLoading.value = true
  try {
    await deleteById(databaseId)
    toast.add({
      title: 'Database deleted',
      color: 'success',
      icon: 'i-lucide-check'
    })
    router.push('/dashboard/databases')
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Delete failed',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    deleteLoading.value = false
  }
}

// Get server name by ID
function getServerName(serverId: string) {
  const server = serversData.value?.items?.find(s => s._id === serverId)
  return server?.name || server?.host || serverId
}

function getServerHost(serverId: string) {
  const server = serversData.value?.items?.find(s => s._id === serverId)
  return server?.host || serverId
}

// Status colors
function getStatusColor(status: string) {
  switch (status) {
    case 'running': return 'success'
    case 'provisioning': return 'warning'
    case 'syncing': return 'warning'
    case 'failed': return 'error'
    case 'stopped': return 'neutral'
    default: return 'neutral'
  }
}

function getHealthColor(health: number) {
  return health === 1 ? 'success' : 'error'
}

function getRoleIcon(role: string) {
  switch (role) {
    case 'primary': return 'i-lucide-crown'
    case 'secondary': return 'i-lucide-copy'
    case 'arbiter': return 'i-lucide-scale'
    case 'standalone': return 'i-lucide-database'
    default: return 'i-lucide-server'
  }
}

// Fetch health on mount if running
onMounted(() => {
  if (database.value?.status === 'running') {
    fetchHealth()
  }
})

// Refetch health when database status changes to running
watch(() => database.value?.status, (newStatus) => {
  if (newStatus === 'running') {
    fetchHealth()
  }
})

useHead({ title: computed(() => database.value ? `${database.value.name} · Databases` : 'Database') })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/dashboard/databases"
        />
        <div v-if="database">
          <div class="flex items-center gap-2">
            <h1 class="text-2xl font-bold text-highlighted">
              {{ database.name }}
            </h1>
            <UBadge
              :color="getStatusColor(database.status)"
              variant="subtle"
            >
              {{ database.status }}
            </UBadge>
          </div>
          <p class="text-sm text-muted">
            {{ database.type }} {{ database.version }}
            <span v-if="database.nodes?.length"> · {{ database.nodes.length }} node{{ database.nodes.length > 1 ? 's' : '' }}</span>
          </p>
        </div>
        <USkeleton v-else class="h-12 w-48" />
      </div>

      <div v-if="database" class="flex items-center gap-2">
        <UButton
          icon="i-lucide-key"
          color="neutral"
          variant="outline"
          :loading="credentialsLoading"
          :disabled="database.status !== 'running'"
          @click="handleViewCredentials"
        >
          Credentials
        </UButton>
        <UDropdownMenu
          :items="[
            [
              { label: 'Reprovision', icon: 'i-lucide-refresh-cw', onSelect: handleReprovision },
              { label: 'Refresh Health', icon: 'i-lucide-activity', onSelect: fetchHealth, disabled: database.status !== 'running' }
            ],
            [
              { label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => deleteOpen = true }
            ]
          ]"
        >
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="outline"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="space-y-4">
      <USkeleton class="h-32 rounded-xl" />
      <USkeleton class="h-48 rounded-xl" />
    </div>

    <!-- Content -->
    <div v-else-if="database" class="space-y-6">
      <!-- Health Overview -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-highlighted">
            Cluster Health
          </h2>
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="healthLoading"
            :disabled="database.status !== 'running'"
            @click="fetchHealth"
          />
        </div>

        <div v-if="database.status !== 'running'" class="text-center py-8">
          <UIcon name="i-lucide-clock" class="size-8 text-muted mx-auto mb-2" />
          <p class="text-muted">
            Health check available when database is running
          </p>
        </div>

        <div v-else-if="healthLoading" class="flex items-center justify-center py-8">
          <UIcon name="i-lucide-loader-2" class="size-6 animate-spin text-muted" />
        </div>

        <div v-else-if="health" class="space-y-3">
          <div class="flex items-center gap-2">
            <UIcon
              :name="health.status === 'healthy' ? 'i-lucide-check-circle' : 'i-lucide-alert-circle'"
              :class="health.status === 'healthy' ? 'text-success' : 'text-error'"
              class="size-5"
            />
            <span class="font-medium" :class="health.status === 'healthy' ? 'text-success' : 'text-error'">
              {{ health.status === 'healthy' ? 'Healthy' : 'Unhealthy' }}
            </span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div
              v-for="member in health.members"
              :key="member.host"
              class="rounded-lg border border-default bg-default/50 p-3"
            >
              <div class="flex items-center justify-between">
                <span class="text-sm font-mono truncate">{{ member.host }}</span>
                <UBadge
                  :color="getHealthColor(member.health)"
                  variant="subtle"
                  size="xs"
                >
                  {{ member.state }}
                </UBadge>
              </div>
            </div>
          </div>
        </div>

        <div v-else class="text-center py-8">
          <p class="text-muted">
            Click refresh to check health
          </p>
        </div>
      </div>

      <!-- Nodes -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-lg font-semibold text-highlighted">
            Nodes
          </h2>
          <UButton
            icon="i-lucide-plus"
            size="sm"
            :disabled="database.status === 'provisioning' || availableServers.length === 0"
            @click="openAddNode"
          >
            Add Node
          </UButton>
        </div>

        <div v-if="!database.nodes?.length" class="text-center py-8">
          <UIcon name="i-lucide-server" class="size-8 text-muted mx-auto mb-2" />
          <p class="text-muted">
            No nodes configured
          </p>
        </div>

        <div v-else class="space-y-2">
          <div
            v-for="node in database.nodes"
            :key="node.serverId"
            class="flex items-center justify-between rounded-lg border border-default bg-default/50 px-4 py-3"
          >
            <div class="flex items-center gap-3">
              <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
                <UIcon
                  :name="getRoleIcon(node.role)"
                  class="size-4 text-muted"
                />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-highlighted">
                    {{ getServerName(node.serverId) }}
                  </span>
                  <UBadge color="neutral" variant="outline" size="xs">
                    {{ node.role }}
                  </UBadge>
                  <UBadge
                    :color="getStatusColor(node.status)"
                    variant="subtle"
                    size="xs"
                  >
                    {{ node.status }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted font-mono">
                  {{ getServerHost(node.serverId) }}
                </p>
              </div>
            </div>

            <UButton
              v-if="node.role !== 'primary' && node.role !== 'standalone' && database.nodes!.length > 1"
              icon="i-lucide-trash"
              color="error"
              variant="ghost"
              size="sm"
              @click="openRemoveNode(node)"
            />
          </div>
        </div>

        <UAlert
          v-if="availableServers.length === 0 && database.nodes?.length"
          class="mt-4"
          color="warning"
          variant="soft"
          icon="i-lucide-info"
          title="No available servers"
          description="All online servers are already part of this cluster. Add more servers to scale out."
        />
      </div>

      <!-- Connection Info -->
      <div class="rounded-xl border border-default bg-elevated/50 p-6">
        <h2 class="text-lg font-semibold text-highlighted mb-4">
          Connection Information
        </h2>

        <div class="space-y-3">
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Type</label>
            <p class="font-medium capitalize">{{ database.type }}</p>
          </div>
          <div>
            <label class="text-xs text-muted uppercase tracking-wide">Version</label>
            <p class="font-medium">{{ database.version }}</p>
          </div>
          <div v-if="database.config?.replicaSetName">
            <label class="text-xs text-muted uppercase tracking-wide">Replica Set Name</label>
            <p class="font-mono">{{ database.config.replicaSetName }}</p>
          </div>
          <div v-if="database.config?.port">
            <label class="text-xs text-muted uppercase tracking-wide">Port</label>
            <p class="font-mono">{{ database.config.port }}</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Not found -->
    <div v-else class="text-center py-12">
      <UIcon name="i-lucide-database" class="size-12 text-muted mx-auto mb-4" />
      <h2 class="text-lg font-semibold text-highlighted">
        Database not found
      </h2>
      <p class="text-muted mt-1">
        The database you're looking for doesn't exist.
      </p>
      <UButton
        class="mt-4"
        to="/dashboard/databases"
        variant="outline"
      >
        Back to Databases
      </UButton>
    </div>

    <!-- Credentials Modal -->
    <UModal v-model:open="credentialsOpen" class="max-w-md">
      <template #header>
        <h3 class="text-lg font-semibold">Database Credentials</h3>
      </template>
      <template #body>
        <div v-if="credentials" class="p-6 space-y-4">
          <UFormField label="Admin User">
            <div class="flex gap-2">
              <UInput :model-value="credentials.adminUser" readonly class="flex-1" />
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
              <UInput :model-value="credentials.adminPassword" type="password" readonly class="flex-1" />
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
              <UInput :model-value="credentials.connectionString" readonly class="flex-1 font-mono text-xs" />
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
            description="Store these credentials securely. They provide full access to your database."
          />

          <div class="flex justify-end pt-2 border-t border-default">
            <UButton label="Close" color="neutral" variant="outline" @click="credentialsOpen = false" />
          </div>
        </div>
      </template>
    </UModal>

    <!-- Add Node Modal -->
    <UModal v-model:open="addNodeOpen" class="max-w-md">
      <template #header>
        <h3 class="text-lg font-semibold">Add Node</h3>
      </template>
      <template #body>
        <div class="p-6 space-y-4">
          <p class="text-sm text-muted">
            Add a new node to scale your database cluster.
            {{ database?.nodes?.length === 1 && database?.nodes?.[0]?.role === 'standalone'
              ? 'This will convert your standalone database to a replica set.'
              : '' }}
          </p>

          <UFormField label="Server">
            <USelect
              v-model="addNodeForm.serverId"
              :items="availableServers.map(s => ({ value: s._id, label: `${s.name} (${s.host})` }))"
              placeholder="Select a server"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Role">
            <USelect
              v-model="addNodeForm.role"
              :items="[
                { value: 'secondary', label: 'Secondary - Data replica for read scaling and failover' },
                { value: 'arbiter', label: 'Arbiter - Voting member only (no data)' }
              ]"
              class="w-full"
            />
          </UFormField>

          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-info"
            title="Provisioning time"
            description="Adding a node may take several minutes. The node will sync data from the primary."
          />
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="addNodeOpen = false">
          Cancel
        </UButton>
        <UButton
          :loading="addNodeLoading"
          :disabled="!addNodeForm.serverId"
          icon="i-lucide-plus"
          @click="submitAddNode"
        >
          Add Node
        </UButton>
      </template>
    </UModal>

    <!-- Remove Node Modal -->
    <UModal v-model:open="removeNodeOpen" class="max-w-sm">
      <template #header>
        <h3 class="text-lg font-semibold">Remove Node</h3>
      </template>
      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
              <UIcon name="i-lucide-alert-triangle" class="size-5 text-error" />
            </div>
            <div>
              <p class="text-muted">
                Are you sure you want to remove
                <span class="font-medium text-highlighted">{{ removeNodeTarget ? getServerName(removeNodeTarget.serverId) : '' }}</span>
                from this cluster?
              </p>
              <p class="text-sm text-muted mt-2">
                The node will be stopped and removed from the replica set.
              </p>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="removeNodeOpen = false">
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="removeNodeLoading"
          icon="i-lucide-trash"
          @click="submitRemoveNode"
        >
          Remove Node
        </UButton>
      </template>
    </UModal>

    <!-- Delete Modal -->
    <UModal v-model:open="deleteOpen" class="max-w-sm">
      <template #header>
        <h3 class="text-lg font-semibold">Delete Database</h3>
      </template>
      <template #body>
        <div class="p-6">
          <div class="flex items-start gap-4">
            <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
              <UIcon name="i-lucide-alert-triangle" class="size-5 text-error" />
            </div>
            <div>
              <p class="text-muted">
                Are you sure you want to delete
                <span class="font-medium text-highlighted">{{ database?.name }}</span>?
              </p>
              <p class="text-sm text-muted mt-2">
                This will stop all nodes and remove the database. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" @click="deleteOpen = false">
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleteLoading"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Database
        </UButton>
      </template>
    </UModal>
  </div>
</template>
