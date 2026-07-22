<script setup lang="ts">
/**
 * Nodes page — list and manage Kubernetes worker nodes.
 * Phase 2 of the control-plane overhaul: Node Management.
 *
 * Features:
 * - List all nodes with status, role, resources
 * - Generate join token for new worker nodes
 * - View node details
 * - Cordon/Uncordon, Drain, Remove nodes
 * - Sync nodes from K8s API
 */
import type { TableColumn } from '@nuxt/ui'

// API error type helper
type ApiError = { data?: { message?: string }, message?: string }
function getErrorMessage(error: unknown, fallback: string): string {
  const err = error as ApiError
  return err?.data?.message || err?.message || fallback
}

definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

useHead({ title: 'Nodes · Control Plane' })

// ----------------------------------------------------------------------------
// Composables and state
// ----------------------------------------------------------------------------

const toast = useToast()
const { getAll: getClusters } = useCluster()
const { getAll: getSecrets } = useSecret()
const {
  node: nodeRef,
  getAllByCluster,
  generateJoinToken,
  testConnection,
  provision,
  getProvisioningStatus,
  retryProvision,
  syncAll,
  cordon,
  uncordon,
  drain,
  remove
} = useNode()

// Cluster state (local cluster)
const clusterId = ref<string | null>(null)
const clusterName = ref('')

// Table state
const page = ref(1)
const roleFilter = ref<TNodeRole | '__all__'>('__all__')
const statusFilter = ref<TNodeStatus | '__all__'>('__all__')

// ----------------------------------------------------------------------------
// Fetch cluster first (we only support local cluster for now)
// ----------------------------------------------------------------------------

const { data: clusterData, status: clusterStatus } = await useLazyAsyncData(
  'nodes-cluster',
  async () => {
    const result = await getClusters({ page: 1 })
    const local = result.clusters?.find(c => c.type === 'local')
    if (local) {
      clusterId.value = local._id
      clusterName.value = local.name || 'Local Cluster'
    }
    return local
  },
  { immediate: true, server: false }
)

// ----------------------------------------------------------------------------
// Fetch nodes for the cluster
// ----------------------------------------------------------------------------

const { data: nodesData, status: nodesStatus, refresh: refreshNodes } = await useLazyAsyncData(
  'nodes-list',
  async () => {
    if (!clusterId.value) return { items: [] as TNode[], pages: 0, total: 0 }
    const result = await getAllByCluster(clusterId.value, {
      page: page.value,
      role: roleFilter.value === '__all__' ? undefined : roleFilter.value,
      status: statusFilter.value === '__all__' ? undefined : statusFilter.value
    })
    return { ...result, total: result.items?.length ?? 0 }
  },
  { immediate: true, server: false, watch: [clusterId, page, roleFilter, statusFilter] }
)

const loading = computed(() => nodesStatus.value === 'pending' || clusterStatus.value === 'pending')
const nodes = computed(() => nodesData.value?.items ?? [])
const totalPages = computed(() => nodesData.value?.pages ?? 1)
const totalNodes = computed(() => nodesData.value?.total ?? 0)
const pageSize = 50

// Watch for filter/page changes to refresh
watch([roleFilter, statusFilter], () => {
  page.value = 1 // Reset to first page when filters change
})

// ----------------------------------------------------------------------------
// Table columns
// ----------------------------------------------------------------------------

const columns: TableColumn<TNode>[] = [
  {
    accessorKey: 'name',
    header: 'Name'
  },
  {
    accessorKey: 'role',
    header: 'Role'
  },
  {
    accessorKey: 'status',
    header: 'Status'
  },
  {
    accessorKey: 'host',
    header: 'IP Address'
  },
  {
    accessorKey: 'k8sVersion',
    header: 'Version'
  },
  {
    id: 'resources',
    header: 'Resources'
  },
  {
    id: 'actions'
  }
]

// ----------------------------------------------------------------------------
// Modal state (single setter pattern)
// ----------------------------------------------------------------------------

type ModalMode = 'add' | 'provision' | 'view' | 'edit' | 'delete' | 'drain' | 'joinCommand' | 'provisioningStatus'

const openAdd = ref(false)
const openProvision = ref(false)
const openProvisioningStatus = ref(false)
const openView = ref(false)
const openEdit = ref(false)
const openDelete = ref(false)
const openDrain = ref(false)
const openJoinCommand = ref(false)
const loadingForm = ref(false)
const formMessage = ref('')
const joinCommand = ref('')
const selectedNode = ref<TNode | null>(null)
const provisionFormRef = ref<{ setTestResult: (result: TTestConnectionResponse) => void } | null>(null)

// SSH keys for provisioning form
const sshKeys = ref<Array<{ _id: string; name: string }>>([])

/**
 * Central state setter — resets the resource, message, and opens/closes the right modal.
 * Never toggle modal refs directly; always use setItem().
 */
function setItem({
  value = { ...useNode().node.value },
  mode = '' as ModalMode | '',
  open = false
} = {}) {
  // Deep copy the node value to avoid mutations
  Object.assign(nodeRef.value, JSON.parse(JSON.stringify(value)))
  formMessage.value = ''

  if (mode === 'add') {
    // Reset the node to a fresh default for add mode
    nodeRef.value = { ...useNode().node.value }
    openAdd.value = open
  }
  if (mode === 'provision') openProvision.value = open
  if (mode === 'provisioningStatus') openProvisioningStatus.value = open
  if (mode === 'view') {
    selectedNode.value = value as TNode
    openView.value = open
  }
  if (mode === 'edit') openEdit.value = open
  if (mode === 'delete') openDelete.value = open
  if (mode === 'drain') openDrain.value = open
  if (mode === 'joinCommand') {
    joinCommand.value = (value as TNode)?.joinCommand || ''
    openJoinCommand.value = open
  }
}

// Load SSH keys when opening provision modal
async function openProvisionModal() {
  try {
    // SSH keys are stored via /ssh-keys API, not /secrets
    const result = await useNuxtApp().$api<{ items: Array<{ _id: string; name: string }> }>('/ssh-keys')
    sshKeys.value = (result.items || []).map((k) => ({ _id: k._id, name: k.name }))
  } catch {
    sshKeys.value = []
  }
  setItem({ mode: 'provision', open: true })
}

function handleRowClick(_e: Event, row: { original: TNode }) {
  // If node is provisioning, show provisioning status
  if (row.original.provisioningStatus === 'running' || row.original.status === 'provisioning') {
    setItem({ value: row.original, mode: 'provisioningStatus', open: true })
  } else {
    setItem({ value: row.original, mode: 'view', open: true })
  }
}

// ----------------------------------------------------------------------------
// Node operations
// ----------------------------------------------------------------------------

// Test SSH connection before provisioning
async function handleTestConnection(data: { host: string; sshPort: number; sshUser: string; sshKeyId: string }) {
  try {
    const result = await testConnection(data)
    provisionFormRef.value?.setTestResult(result)
  } catch (error) {
    provisionFormRef.value?.setTestResult({
      success: false,
      error: getErrorMessage(error, 'Connection test failed')
    })
  }
}

// Provision a new worker node
async function handleProvision(data: TNodeProvisionInput) {
  loadingForm.value = true
  formMessage.value = ''

  try {
    const result = await provision(data)
    toast.add({
      title: 'Provisioning started',
      description: `Node "${data.name}" is being provisioned.`,
      color: 'info',
      icon: 'i-lucide-rocket'
    })

    // Close provision form and open provisioning status
    setItem({ value: result.node, mode: 'provisioningStatus', open: true })

    await refreshNodes()
  } catch (error) {
    formMessage.value = getErrorMessage(error, 'Failed to start provisioning')
    toast.add({
      title: 'Error',
      description: formMessage.value,
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  } finally {
    loadingForm.value = false
  }
}

// Refresh provisioning status
async function handleRefreshProvisioningStatus() {
  if (!selectedNode.value) return

  try {
    const result = await getProvisioningStatus(selectedNode.value._id)
    selectedNode.value = result.node
    nodeRef.value = result.node
  } catch {
    // Ignore - will retry
  }
}

// Retry provisioning for a failed node
async function handleRetryProvision() {
  if (!selectedNode.value) return

  loadingForm.value = true
  try {
    const result = await retryProvision(selectedNode.value._id)
    toast.add({
      title: 'Provisioning retry started',
      description: `Retrying provisioning for "${selectedNode.value.name}".`,
      color: 'info',
      icon: 'i-lucide-refresh-cw'
    })
    selectedNode.value = result.node
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Error',
      description: getErrorMessage(error, 'Failed to retry provisioning'),
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  } finally {
    loadingForm.value = false
  }
}

async function handleGenerateJoinToken() {
  if (!clusterId.value || !nodeRef.value.name?.trim()) return

  loadingForm.value = true
  formMessage.value = ''

  try {
    const result = await generateJoinToken(clusterId.value, nodeRef.value.name.trim())
    toast.add({
      title: 'Join token generated',
      description: `Run the command on your VM to join "${nodeRef.value.name}" to the cluster.`,
      color: 'success',
      icon: 'i-lucide-check-circle'
    })

    // Show the join command modal (close add modal, open joinCommand modal)
    setItem({ value: result.node, mode: 'joinCommand', open: true })

    await refreshNodes()
  } catch (error) {
    formMessage.value = getErrorMessage(error, 'Failed to generate join token')
    toast.add({
      title: 'Error',
      description: formMessage.value,
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  } finally {
    loadingForm.value = false
  }
}

async function handleSyncAll() {
  if (!clusterId.value) return

  try {
    const result = await syncAll(clusterId.value)
    toast.add({
      title: 'Nodes synced',
      description: `Synced ${result.nodes?.length || 0} nodes from Kubernetes.`,
      color: 'success',
      icon: 'i-lucide-refresh-cw'
    })
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Sync failed',
      description: getErrorMessage(error, 'Failed to sync nodes'),
      color: 'error',
      icon: 'i-lucide-alert-circle'
    })
  }
}

async function handleCordon(node: TNode) {
  try {
    await cordon(node._id)
    toast.add({
      title: 'Node cordoned',
      description: `${node.name} is now unschedulable.`,
      color: 'warning',
      icon: 'i-lucide-shield-off'
    })
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Cordon failed',
      description: getErrorMessage(error, 'Failed to cordon node'),
      color: 'error'
    })
  }
}

async function handleUncordon(node: TNode) {
  try {
    await uncordon(node._id)
    toast.add({
      title: 'Node uncordoned',
      description: `${node.name} is now schedulable.`,
      color: 'success',
      icon: 'i-lucide-shield-check'
    })
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Uncordon failed',
      description: getErrorMessage(error, 'Failed to uncordon node'),
      color: 'error'
    })
  }
}

async function handleDrain() {
  if (!selectedNode.value) return

  loadingForm.value = true
  try {
    await drain(selectedNode.value._id, { ignoreDaemonSets: true })
    toast.add({
      title: 'Node drained',
      description: `All pods evicted from ${selectedNode.value.name}.`,
      color: 'success',
      icon: 'i-lucide-arrow-right-from-line'
    })
    openDrain.value = false
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Drain failed',
      description: getErrorMessage(error, 'Failed to drain node'),
      color: 'error'
    })
  } finally {
    loadingForm.value = false
  }
}

async function handleRemove() {
  if (!selectedNode.value) return

  loadingForm.value = true
  try {
    await remove(selectedNode.value._id)
    toast.add({
      title: 'Node removed',
      description: `${selectedNode.value.name} has been removed from the cluster.`,
      color: 'success',
      icon: 'i-lucide-trash-2'
    })
    openDelete.value = false
    await refreshNodes()
  } catch (error) {
    toast.add({
      title: 'Remove failed',
      description: getErrorMessage(error, 'Failed to remove node'),
      color: 'error'
    })
  } finally {
    loadingForm.value = false
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function getStatusColor(status: TNodeStatus): 'success' | 'error' | 'warning' | 'info' | 'neutral' {
  switch (status) {
    case 'ready':
      return 'success'
    case 'not-ready':
    case 'offline':
    case 'failed':
      return 'error'
    case 'pending':
    case 'joining':
    case 'provisioning':
      return 'info'
    case 'draining':
    case 'deleting':
      return 'warning'
    default:
      return 'neutral'
  }
}

function getRoleColor(role: TNodeRole): 'primary' | 'neutral' {
  return role === 'master' ? 'primary' : 'neutral'
}

function formatResources(node: TNode): string {
  if (!node.resources) return '—'
  const cpu = node.resources.cpuAllocatable || node.resources.cpuCapacity || '?'
  const mem = node.resources.memoryAllocatable || node.resources.memoryCapacity || '?'
  return `${cpu} CPU · ${mem} RAM`
}

function getNodeActions(node: TNode) {
  const actions = []

  // View details / Provisioning status
  if (node.provisioningStatus === 'running' || node.status === 'provisioning') {
    actions.push([
      {
        label: 'View provisioning status',
        icon: 'i-lucide-loader',
        onSelect: () => setItem({ value: node, mode: 'provisioningStatus', open: true })
      }
    ])
  } else if (node.status === 'failed') {
    actions.push([
      {
        label: 'View failure details',
        icon: 'i-lucide-alert-circle',
        onSelect: () => setItem({ value: node, mode: 'provisioningStatus', open: true })
      },
      {
        label: 'Retry provisioning',
        icon: 'i-lucide-refresh-cw',
        onSelect: () => {
          selectedNode.value = node
          handleRetryProvision()
        }
      }
    ])
  } else {
    actions.push([
      {
        label: 'View details',
        icon: 'i-lucide-eye',
        onSelect: () => setItem({ value: node, mode: 'view', open: true })
      }
    ])
  }

  // Node operations (only for ready/not-ready workers)
  if (node.role === 'worker' && ['ready', 'not-ready'].includes(node.status)) {
    const ops = []

    if (!node.unschedulable) {
      ops.push({
        label: 'Cordon (disable scheduling)',
        icon: 'i-lucide-shield-off',
        onSelect: () => handleCordon(node)
      })
    } else {
      ops.push({
        label: 'Uncordon (enable scheduling)',
        icon: 'i-lucide-shield-check',
        onSelect: () => handleUncordon(node)
      })
    }

    ops.push({
      label: 'Drain (evict pods)',
      icon: 'i-lucide-arrow-right-from-line',
      onSelect: () => setItem({ value: node, mode: 'drain', open: true })
    })

    actions.push(ops)
  }

  // Show join command for pending nodes
  if (node.status === 'pending' && node.joinCommand) {
    actions.push([
      {
        label: 'Show join command',
        icon: 'i-lucide-terminal',
        onSelect: () => setItem({ value: node, mode: 'joinCommand', open: true })
      }
    ])
  }

  // Delete (only for workers, not for masters)
  if (node.role === 'worker') {
    actions.push([
      {
        label: 'Remove from cluster',
        icon: 'i-lucide-trash-2',
        color: 'error' as const,
        onSelect: () => setItem({ value: node, mode: 'delete', open: true })
      }
    ])
  }

  return actions
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    toast.add({
      title: 'Copied',
      description: 'Join command copied to clipboard.',
      color: 'success',
      icon: 'i-lucide-clipboard-check'
    })
  } catch {
    toast.add({
      title: 'Copy failed',
      description: 'Could not copy to clipboard.',
      color: 'error'
    })
  }
}
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Nodes
        </h1>
        <p class="text-muted">
          Manage worker nodes in your Kubernetes cluster.
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          variant="soft"
          color="neutral"
          icon="i-lucide-refresh-cw"
          label="Sync"
          :disabled="!clusterId"
          @click="handleSyncAll"
        />
        <UDropdownMenu
          :items="[
            [
              {
                label: 'Provision via SSH',
                icon: 'i-lucide-rocket',
                onSelect: () => openProvisionModal()
              },
              {
                label: 'Manual join (advanced)',
                icon: 'i-lucide-terminal',
                onSelect: () => setItem({ mode: 'add', open: true })
              }
            ]
          ]"
        >
          <UButton
            icon="i-lucide-plus"
            label="Add Worker"
            trailing-icon="i-lucide-chevron-down"
            :disabled="!clusterId"
          />
        </UDropdownMenu>
      </div>
    </div>

    <!-- Cluster info banner -->
    <UAlert
      v-if="clusterData"
      :title="`Cluster: ${clusterName}`"
      :description="`${totalNodes} node${totalNodes !== 1 ? 's' : ''} in cluster`"
      icon="i-lucide-server"
      color="info"
      variant="subtle"
    />
    <UAlert
      v-else-if="clusterStatus === 'success'"
      title="No cluster found"
      description="Initialize your Kubernetes cluster to manage nodes."
      icon="i-lucide-alert-triangle"
      color="warning"
      variant="subtle"
    />

    <!-- Filters -->
    <div class="flex flex-wrap items-center gap-4">
      <USelect
        v-model="roleFilter"
        placeholder="All roles"
        :items="[
          { label: 'All roles', value: '__all__' },
          { label: 'Master', value: 'master' },
          { label: 'Worker', value: 'worker' }
        ]"
        value-key="value"
        class="w-40"
      />
      <USelect
        v-model="statusFilter"
        placeholder="All statuses"
        :items="[
          { label: 'All statuses', value: '__all__' },
          { label: 'Ready', value: 'ready' },
          { label: 'Not Ready', value: 'not-ready' },
          { label: 'Pending', value: 'pending' },
          { label: 'Offline', value: 'offline' }
        ]"
        value-key="value"
        class="w-40"
      />
    </div>

    <!-- Nodes Table -->
    <UCard>
      <UTable
        :data="nodes"
        :columns="columns"
        :loading="loading"
        @select="handleRowClick"
      >
        <!-- Name -->
        <template #name-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon
              :name="row.original.role === 'master' ? 'i-lucide-crown' : 'i-lucide-hard-drive'"
              class="size-4 text-muted"
            />
            <span class="font-medium">{{ row.original.name }}</span>
            <UBadge
              v-if="row.original.unschedulable"
              label="Cordoned"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
        </template>

        <!-- Role -->
        <template #role-cell="{ row }">
          <UBadge
            :label="row.original.role"
            :color="getRoleColor(row.original.role)"
            variant="subtle"
          />
        </template>

        <!-- Status -->
        <template #status-cell="{ row }">
          <UBadge
            :label="row.original.status"
            :color="getStatusColor(row.original.status)"
            variant="subtle"
          />
        </template>

        <!-- Host -->
        <template #host-cell="{ row }">
          <span class="font-mono text-sm text-muted">{{ row.original.host || '—' }}</span>
        </template>

        <!-- Version -->
        <template #k8sVersion-cell="{ row }">
          <span class="text-sm text-muted">{{ row.original.k8sVersion || '—' }}</span>
        </template>

        <!-- Resources -->
        <template #resources-cell="{ row }">
          <span class="text-sm text-muted">{{ formatResources(row.original) }}</span>
        </template>

        <!-- Actions -->
        <template #actions-cell="{ row }">
          <UDropdownMenu :items="getNodeActions(row.original)">
            <UButton
              icon="i-lucide-ellipsis"
              color="neutral"
              variant="ghost"
              size="sm"
              @click.stop
            />
          </UDropdownMenu>
        </template>

        <!-- Empty state -->
        <template #empty>
          <div class="py-12 text-center">
            <UIcon name="i-lucide-hard-drive" class="mx-auto size-12 text-muted" />
            <h3 class="mt-4 font-semibold text-highlighted">
              No nodes found
            </h3>
            <p class="mt-2 text-sm text-muted">
              {{ clusterId ? 'Add a worker node to run workloads.' : 'Initialize your cluster first.' }}
            </p>
            <UButton
              v-if="clusterId"
              class="mt-4"
              icon="i-lucide-plus"
              label="Add Worker"
              @click="setItem({ mode: 'add', open: true })"
            />
          </div>
        </template>
      </UTable>

      <!-- Pagination -->
      <div v-if="totalPages > 1" class="flex justify-end border-t border-default p-4">
        <UPagination
          v-model:page="page"
          :total="totalNodes"
          :items-per-page="pageSize"
        />
      </div>
    </UCard>

    <!-- Add Worker Modal -->
    <UModal v-model:open="openAdd">
      <template #content>
        <NodeForm
          v-model="nodeRef"
          v-model:message="formMessage"
          title="Add Worker Node"
          mode="add"
          :loading="loadingForm"
          @close="setItem({ mode: 'add' })"
          @submit="handleGenerateJoinToken"
        />
      </template>
    </UModal>

    <!-- Join Command Modal -->
    <UModal v-model:open="openJoinCommand">
      <template #content>
        <div class="p-4 space-y-4">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-success/10">
              <UIcon name="i-lucide-terminal" class="size-5 text-success" />
            </div>
            <div>
              <h3 class="font-semibold text-highlighted">
                Join Command Ready
              </h3>
              <p class="text-sm text-muted">
                Run this command on your worker VM.
              </p>
            </div>
          </div>

          <UAlert
            title="Important"
            description="Run this command as root on your worker VM. The node will appear in the list once it joins the cluster."
            icon="i-lucide-alert-triangle"
            color="warning"
            variant="subtle"
          />

          <div class="relative">
            <pre class="overflow-x-auto rounded-lg bg-muted p-4 text-sm font-mono">{{ joinCommand }}</pre>
            <UButton
              class="absolute right-2 top-2"
              icon="i-lucide-copy"
              color="neutral"
              variant="ghost"
              size="xs"
              @click="copyToClipboard(joinCommand)"
            />
          </div>

          <p class="text-sm text-muted">
            Node: <span class="font-medium text-highlighted">{{ selectedNode?.name }}</span>
          </p>
        </div>

        <div class="sticky bottom-0 border-t border-default bg-default flex justify-end p-4">
          <UButton
            label="Done"
            @click="setItem({ mode: 'joinCommand' })"
          />
        </div>
      </template>
    </UModal>

    <!-- View Node Modal (using NodeForm) -->
    <UModal v-model:open="openView">
      <template #content>
        <NodeForm
          v-if="selectedNode"
          v-model="nodeRef"
          v-model:message="formMessage"
          mode="view"
          :loading="loadingForm"
          @close="setItem({ mode: 'view' })"
          @edit="setItem({ value: selectedNode, mode: 'edit', open: true })"
          @delete="setItem({ value: selectedNode, mode: 'delete', open: true })"
        />
      </template>
    </UModal>

    <!-- Edit Node Modal -->
    <UModal v-model:open="openEdit">
      <template #content>
        <NodeForm
          v-if="selectedNode"
          v-model="nodeRef"
          v-model:message="formMessage"
          mode="edit"
          :loading="loadingForm"
          @close="setItem({ mode: 'edit' })"
          @submit="setItem({ mode: 'edit' })"
        />
      </template>
    </UModal>

    <!-- Drain Confirmation -->
    <UModal v-model:open="openDrain">
      <template #content>
        <div class="p-4 space-y-4">
          <div class="flex items-center gap-3">
            <div class="flex size-10 items-center justify-center rounded-lg bg-warning/10">
              <UIcon name="i-lucide-arrow-right-from-line" class="size-5 text-warning" />
            </div>
            <div>
              <h3 class="font-semibold text-highlighted">
                Drain Node
              </h3>
              <p class="text-sm text-muted">
                Evict all pods from this node.
              </p>
            </div>
          </div>

          <UAlert
            title="Warning"
            :description="`This will evict all pods from ${selectedNode?.name}. Pods managed by ReplicaSets or Deployments will be rescheduled on other nodes. DaemonSet pods will be ignored.`"
            icon="i-lucide-alert-triangle"
            color="warning"
            variant="subtle"
          />
        </div>

        <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 p-4">
          <UButton
            class="flex-1"
            variant="ghost"
            label="Cancel"
            @click="setItem({ mode: 'drain' })"
          />
          <UButton
            class="flex-1"
            color="warning"
            label="Drain Node"
            :loading="loadingForm"
            @click="handleDrain"
          />
        </div>
      </template>
    </UModal>

    <!-- Delete Confirmation -->
    <UModal v-model:open="openDelete">
      <template #content>
        <ConfirmationPrompt
          title="Remove Node"
          :description="`Are you sure you want to remove ${selectedNode?.name} from the cluster? This will drain the node first, then remove it from Kubernetes.`"
          confirm-text="Remove"
          confirm-color="error"
          :loading="loadingForm"
          @close="setItem({ mode: 'delete' })"
          @confirm="handleRemove"
        />
      </template>
    </UModal>

    <!-- Provision Node Modal -->
    <UModal v-model:open="openProvision" :ui="{ content: 'sm:max-w-lg' }">
      <template #content>
        <NodeProvisionForm
          v-if="clusterId"
          ref="provisionFormRef"
          :cluster-id="clusterId"
          :ssh-keys="sshKeys"
          :loading="loadingForm"
          v-model:message="formMessage"
          @close="setItem({ mode: 'provision' })"
          @submit="handleProvision"
          @test-connection="handleTestConnection"
        />
      </template>
    </UModal>

    <!-- Provisioning Status Modal -->
    <UModal v-model:open="openProvisioningStatus">
      <template #content>
        <NodeProvisioningStatus
          v-if="selectedNode"
          :node="selectedNode"
          :loading="loadingForm"
          @close="setItem({ mode: 'provisioningStatus' }); refreshNodes()"
          @retry="handleRetryProvision"
          @refresh="handleRefreshProvisioningStatus"
        />
      </template>
    </UModal>
  </div>
</template>
