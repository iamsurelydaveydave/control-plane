<script setup lang="ts">
/**
 * Kubernetes (K3s) Settings — view and manage K8s-based database provisioning.
 *
 * K3s is the lightweight Kubernetes distribution used for database provisioning.
 * When enabled, new databases are provisioned via K8s operators (Percona MongoDB Operator)
 * rather than Ansible playbooks.
 *
 * This page shows:
 * - Whether K8s is enabled
 * - The current provisioner type
 * - K3s cluster status and nodes
 * - The command to join a server as a K3s agent
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getK8sConfig, getK8sNodes, getK8sAgentCommand, refreshK8sToken } = useSettings()

// ---------------------------------------------------------------------------
// Load K8s configuration status
// ---------------------------------------------------------------------------
const { data: configData, refresh: refreshConfig, status: configStatus } = await useLazyAsyncData(
  'k8s-config',
  () => getK8sConfig().catch(() => ({
    kubernetes: { enabled: false, available: false, nodes: 0, error: undefined as string | undefined },
    provisioner: 'ansible' as const,
    hasK3sToken: false
  })),
  { server: false, immediate: true }
)
const config = computed(() => configData.value)

// ---------------------------------------------------------------------------
// Load K8s nodes
// ---------------------------------------------------------------------------
const { data: nodesData, refresh: refreshNodes, status: nodesStatus } = await useLazyAsyncData(
  'k8s-nodes',
  () => getK8sNodes().catch(() => ({ enabled: false, nodes: [] })),
  { server: false, immediate: true }
)
const nodes = computed(() => nodesData.value?.nodes || [])

// ---------------------------------------------------------------------------
// Agent command (load on demand)
// ---------------------------------------------------------------------------
type AgentCommandData = {
  serverUrl: string
  command: string
  instructions: string[]
}
const showAgentCommand = ref(false)
const agentCommandLoading = ref(false)
const agentCommand = ref<AgentCommandData | null>(null)

async function loadAgentCommand() {
  if (agentCommand.value) {
    showAgentCommand.value = true
    return
  }
  agentCommandLoading.value = true
  try {
    agentCommand.value = await getK8sAgentCommand()
    showAgentCommand.value = true
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to get agent command',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    agentCommandLoading.value = false
  }
}

function copyCommand() {
  if (agentCommand.value?.command) {
    navigator.clipboard.writeText(agentCommand.value.command)
    toast.add({ title: 'Command copied to clipboard', color: 'success', icon: 'i-lucide-check' })
  }
}

// ---------------------------------------------------------------------------
// Refresh K3s token
// ---------------------------------------------------------------------------
const refreshTokenLoading = ref(false)

async function handleRefreshToken() {
  refreshTokenLoading.value = true
  try {
    const result = await refreshK8sToken()
    toast.add({
      title: 'Token refreshed',
      description: result.hasToken ? 'Join token updated from K3s' : 'Token not available',
      color: result.hasToken ? 'success' : 'warning',
      icon: result.hasToken ? 'i-lucide-check' : 'i-lucide-alert-triangle'
    })
    // Reset agent command so it will be reloaded with new token
    agentCommand.value = null
    showAgentCommand.value = false
    await refreshConfig()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to refresh token',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    refreshTokenLoading.value = false
  }
}

// ---------------------------------------------------------------------------
// Refresh all data
// ---------------------------------------------------------------------------
const refreshing = ref(false)
async function refreshAll() {
  refreshing.value = true
  try {
    await Promise.all([refreshConfig(), refreshNodes()])
    toast.add({ title: 'Refreshed', color: 'success', icon: 'i-lucide-check' })
  } finally {
    refreshing.value = false
  }
}

useHead({ title: 'Kubernetes Settings · Control Plane' })
</script>

<template>
  <div class="max-w-3xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/dashboard/settings"
        />
        <div>
          <h1 class="text-2xl font-bold text-highlighted">
            Kubernetes Settings
          </h1>
          <p class="text-sm text-muted">
            K3s-based database provisioning with operators
          </p>
        </div>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        :loading="refreshing"
        @click="refreshAll"
      />
    </div>

    <!-- Status Card -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-4">
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Cluster Status
          </h2>
          <p class="text-sm text-muted mt-0.5">
            K3s server and Percona MongoDB Operator
          </p>
        </div>
        <UBadge
          v-if="config?.kubernetes.enabled"
          :color="config?.kubernetes.available ? 'success' : 'warning'"
          variant="subtle"
          :icon="config?.kubernetes.available ? 'i-lucide-check-circle' : 'i-lucide-alert-circle'"
          :label="config?.kubernetes.available ? 'Connected' : 'Unavailable'"
        />
        <UBadge
          v-else
          color="neutral"
          variant="subtle"
          icon="i-lucide-circle-off"
          label="Disabled"
        />
      </div>

      <!-- Status Details -->
      <div
        v-if="configStatus === 'pending'"
        class="flex items-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="size-4 animate-spin"
        />
        <span>Loading status...</span>
      </div>
      <div
        v-else
        class="grid grid-cols-2 sm:grid-cols-4 gap-4"
      >
        <div class="rounded-lg bg-default/50 border border-default p-3">
          <p class="text-xs text-muted uppercase tracking-wide">
            K8s Enabled
          </p>
          <p class="text-lg font-semibold text-highlighted">
            {{ config?.kubernetes.enabled ? 'Yes' : 'No' }}
          </p>
        </div>
        <div class="rounded-lg bg-default/50 border border-default p-3">
          <p class="text-xs text-muted uppercase tracking-wide">
            Provisioner
          </p>
          <p class="text-lg font-semibold text-highlighted capitalize">
            {{ config?.provisioner || '-' }}
          </p>
        </div>
        <div class="rounded-lg bg-default/50 border border-default p-3">
          <p class="text-xs text-muted uppercase tracking-wide">
            Cluster Nodes
          </p>
          <p class="text-lg font-semibold text-highlighted">
            {{ config?.kubernetes.nodes || 0 }}
          </p>
        </div>
        <div class="rounded-lg bg-default/50 border border-default p-3">
          <p class="text-xs text-muted uppercase tracking-wide">
            Token Configured
          </p>
          <p class="text-lg font-semibold text-highlighted">
            {{ config?.hasK3sToken ? 'Yes' : 'No' }}
          </p>
        </div>
      </div>

      <!-- Error Message -->
      <UAlert
        v-if="config?.kubernetes.error"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        :description="config.kubernetes.error"
      />

      <!-- Not Enabled Message -->
      <UAlert
        v-if="!config?.kubernetes.enabled"
        color="info"
        variant="subtle"
        icon="i-lucide-info"
        title="Kubernetes is not enabled"
        description="Set K8S_ENABLED=true in your environment and restart the API to enable K8s-based provisioning. You can enable K8s during installation by choosing 'Yes' when prompted, or by re-running the installer with ENABLE_K8S=true."
      />
    </div>

    <!-- Cluster Nodes -->
    <div
      v-if="config?.kubernetes.enabled"
      class="rounded-xl border border-default bg-elevated/50 p-6 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Cluster Nodes
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Servers joined to the K3s cluster
          </p>
        </div>
      </div>

      <div
        v-if="nodesStatus === 'pending'"
        class="flex items-center gap-2 text-muted"
      >
        <UIcon
          name="i-lucide-loader-2"
          class="size-4 animate-spin"
        />
        <span>Loading nodes...</span>
      </div>
      <div
        v-else-if="nodes.length === 0"
        class="text-center py-8 text-muted"
      >
        <UIcon
          name="i-lucide-server-off"
          class="size-12 mx-auto mb-3 opacity-50"
        />
        <p>No nodes in the cluster</p>
        <p class="text-sm">
          Add a server and it will automatically join as a K3s agent
        </p>
      </div>
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-for="node in nodes"
          :key="node.name"
          class="flex items-center justify-between rounded-lg border border-default bg-default/30 px-4 py-3"
        >
          <div class="flex items-center gap-3">
            <UIcon
              :name="node.ready ? 'i-lucide-server' : 'i-lucide-server-off'"
              :class="node.ready ? 'text-success' : 'text-warning'"
              class="size-5"
            />
            <div>
              <p class="font-medium text-highlighted">
                {{ node.name }}
              </p>
              <p class="text-xs text-muted font-mono">
                {{ node.internalIP || node.hostname || '-' }}
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <UBadge
              v-for="role in node.roles"
              :key="role"
              color="neutral"
              variant="subtle"
              size="xs"
              :label="role"
            />
            <UBadge
              :color="node.ready ? 'success' : 'warning'"
              variant="subtle"
              size="xs"
              :label="node.ready ? 'Ready' : 'Not Ready'"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Add Agent Command -->
    <div
      v-if="config?.kubernetes.enabled"
      class="rounded-xl border border-default bg-elevated/50 p-6 space-y-4"
    >
      <div class="flex items-center justify-between">
        <div>
          <h2 class="text-base font-semibold text-highlighted">
            Join a Server
          </h2>
          <p class="text-sm text-muted mt-0.5">
            Run this command on a database server to join it to the cluster
          </p>
        </div>
        <div class="flex items-center gap-2">
          <UButton
            v-if="config?.hasK3sToken"
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            size="sm"
            :loading="refreshTokenLoading"
            @click="handleRefreshToken"
          >
            Refresh Token
          </UButton>
          <UButton
            v-if="!showAgentCommand && config?.hasK3sToken"
            icon="i-lucide-terminal"
            :loading="agentCommandLoading"
            @click="loadAgentCommand"
          >
            Show Command
          </UButton>
        </div>
      </div>

      <!-- No token available -->
      <UAlert
        v-if="!config?.hasK3sToken"
        color="warning"
        variant="subtle"
        icon="i-lucide-alert-triangle"
        title="Join token not available"
        description="The K3s join token could not be read. Make sure the Control Plane is running on the K3s master node with access to /var/lib/rancher/k3s/server/token, or set K3S_TOKEN in your environment."
      >
        <template #actions>
          <UButton
            color="warning"
            variant="soft"
            size="sm"
            :loading="refreshTokenLoading"
            @click="handleRefreshToken"
          >
            Try to Read Token
          </UButton>
        </template>
      </UAlert>

      <div
        v-if="showAgentCommand && agentCommand"
        class="space-y-4"
      >
        <div class="relative">
          <pre class="rounded-lg bg-default border border-default p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all">{{ agentCommand.command }}</pre>
          <UButton
            icon="i-lucide-copy"
            color="neutral"
            variant="ghost"
            size="xs"
            class="absolute top-2 right-2"
            @click="copyCommand"
          />
        </div>

        <div class="space-y-2">
          <p class="text-sm font-medium text-highlighted">
            Instructions:
          </p>
          <ol class="text-sm text-muted space-y-1 list-decimal list-inside">
            <li
              v-for="(instruction, i) in agentCommand.instructions"
              :key="i"
            >
              {{ instruction }}
            </li>
          </ol>
        </div>

        <UAlert
          color="warning"
          variant="subtle"
          icon="i-lucide-alert-triangle"
          description="This command contains sensitive tokens. Do not share it publicly."
        />
      </div>
    </div>

    <!-- How it works -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-3">
      <h2 class="text-base font-semibold text-highlighted">
        How it works
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div class="space-y-1">
          <p class="font-medium flex items-center gap-2">
            <UIcon
              name="i-lucide-ship"
              class="size-4 text-muted"
            />
            K3s (Lightweight Kubernetes)
          </p>
          <p class="text-muted">
            K3s runs on the control plane server and database servers. It provides
            the orchestration layer for database provisioning with operators.
          </p>
        </div>
        <div class="space-y-1">
          <p class="font-medium flex items-center gap-2">
            <UIcon
              name="i-lucide-database"
              class="size-4 text-muted"
            />
            Percona MongoDB Operator
          </p>
          <p class="text-muted">
            Handles MongoDB cluster lifecycle: provisioning, replica set setup,
            TLS, backups, and automatic failover recovery.
          </p>
        </div>
      </div>

      <hr class="border-default my-4">

      <div class="text-sm text-muted space-y-2">
        <p>
          <strong class="text-highlighted">K8s vs Ansible:</strong>
          When K8s is enabled, new databases are provisioned via the Percona Operator.
          Existing databases (created with Ansible) continue to use Ansible for management.
        </p>
        <p>
          <strong class="text-highlighted">Enabling K8s:</strong>
          Run the installer with
          <code class="bg-default px-1 rounded">ENABLE_K8S=true</code>
          or set
          <code class="bg-default px-1 rounded">K8S_ENABLED=true</code>
          in your
          <code class="bg-default px-1 rounded">.env</code>
          file.
        </p>
      </div>
    </div>
  </div>
</template>
