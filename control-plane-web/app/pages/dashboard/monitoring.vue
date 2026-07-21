<script setup lang="ts">
/**
 * Monitoring page — infrastructure metrics and resource usage.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getOverview, getSystemMetrics, getClusterMetrics, getDatabaseMetrics, getAppMetrics } = useMetrics()

// Auto-refresh interval (30 seconds)
const refreshInterval = 30000
let refreshTimer: ReturnType<typeof setInterval> | null = null

// Fetch all metrics
const { data: overview, status: overviewStatus, refresh: refreshOverview } = await useLazyAsyncData(
  'metrics-overview',
  () => getOverview(),
  { immediate: true, server: false }
)

const { data: system, status: systemStatus, refresh: refreshSystem } = await useLazyAsyncData(
  'metrics-system',
  () => getSystemMetrics(),
  { immediate: true, server: false }
)

const { data: cluster, status: clusterStatus, refresh: refreshCluster } = await useLazyAsyncData(
  'metrics-cluster',
  () => getClusterMetrics(),
  { immediate: true, server: false }
)

const { data: databases, status: databasesStatus, refresh: refreshDatabases } = await useLazyAsyncData(
  'metrics-databases',
  () => getDatabaseMetrics(),
  { immediate: true, server: false }
)

const { data: apps, status: appsStatus, refresh: refreshApps } = await useLazyAsyncData(
  'metrics-apps',
  () => getAppMetrics(),
  { immediate: true, server: false }
)

const loading = computed(() =>
  overviewStatus.value === 'pending' ||
  systemStatus.value === 'pending' ||
  clusterStatus.value === 'pending'
)

// Auto-refresh
async function refreshAll() {
  await Promise.all([
    refreshOverview(),
    refreshSystem(),
    refreshCluster(),
    refreshDatabases(),
    refreshApps()
  ])
}

onMounted(() => {
  refreshTimer = setInterval(refreshAll, refreshInterval)
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})

// Helpers
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)

  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function getStatusColor(status: string): 'success' | 'warning' | 'error' | 'neutral' {
  switch (status) {
    case 'running':
    case 'ready':
    case 'Ready':
      return 'success'
    case 'pending':
    case 'provisioning':
    case 'deploying':
    case 'syncing':
      return 'warning'
    case 'stopped':
    case 'failed':
    case 'NotReady':
    case 'offline':
      return 'error'
    default:
      return 'neutral'
  }
}

function getUsageColor(percent: number): string {
  if (percent >= 90) return 'bg-error'
  if (percent >= 70) return 'bg-warning'
  return 'bg-success'
}

useHead({ title: 'Monitoring · Control Plane' })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Monitoring
        </h1>
        <p class="text-muted">
          Resource usage and infrastructure health.
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        variant="soft"
        color="neutral"
        label="Refresh"
        :loading="loading"
        @click="refreshAll"
      />
    </div>

    <!-- Overview Cards -->
    <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <!-- Apps Card -->
      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Apps
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="overviewStatus === 'pending'">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ overview?.apps?.total ?? 0 }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              name="i-lucide-box"
              class="size-6 text-primary"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ overview?.apps?.running ?? 0 }}</span> running
        </p>
      </div>

      <!-- Databases Card -->
      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Databases
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="overviewStatus === 'pending'">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ overview?.databases?.total ?? 0 }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-info/10">
            <UIcon
              name="i-lucide-database"
              class="size-6 text-info"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ overview?.databases?.healthy ?? 0 }}</span> healthy
        </p>
      </div>

      <!-- Nodes Card -->
      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Cluster Nodes
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="overviewStatus === 'pending'">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ overview?.cluster?.nodesTotal ?? 0 }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-success/10">
            <UIcon
              name="i-lucide-hard-drive"
              class="size-6 text-success"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          <span class="text-success">{{ overview?.cluster?.nodesReady ?? 0 }}</span> ready
        </p>
      </div>

      <!-- Pods Card -->
      <div class="rounded-lg border border-default bg-elevated p-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-muted">
              Pods
            </p>
            <p class="text-2xl font-semibold text-highlighted">
              <template v-if="overviewStatus === 'pending'">
                <span class="inline-block w-8 h-7 bg-muted rounded animate-pulse" />
              </template>
              <template v-else>
                {{ overview?.cluster?.podsRunning ?? 0 }}
              </template>
            </p>
          </div>
          <div class="flex size-12 items-center justify-center rounded-lg bg-warning/10">
            <UIcon
              name="i-lucide-container"
              class="size-6 text-warning"
            />
          </div>
        </div>
        <p class="mt-2 text-xs text-muted">
          Running in cluster
        </p>
      </div>
    </div>

    <!-- System & Cluster Resources -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- System Resources -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Control Plane Server
          </h2>
          <UBadge
            v-if="system"
            color="neutral"
            variant="subtle"
            :label="`Uptime: ${formatUptime(system.uptime)}`"
          />
        </div>
        <div class="p-4 space-y-4">
          <template v-if="systemStatus === 'pending'">
            <div
              v-for="i in 2"
              :key="i"
              class="space-y-2"
            >
              <div class="h-4 w-20 bg-muted rounded animate-pulse" />
              <div class="h-2 w-full bg-muted rounded animate-pulse" />
            </div>
          </template>
          <template v-else-if="system">
            <!-- CPU Usage -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-sm text-muted">CPU Usage</span>
                <span class="text-sm font-medium text-highlighted">
                  {{ system.cpu.usagePercent.toFixed(1) }}%
                </span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="getUsageColor(system.cpu.usagePercent)"
                  :style="{ width: `${Math.min(system.cpu.usagePercent, 100)}%` }"
                />
              </div>
              <p class="text-xs text-muted mt-1">
                {{ system.cpu.cores }} cores · Load: {{ system.cpu.loadAverage[0]?.toFixed(2) }}
              </p>
            </div>

            <!-- Memory Usage -->
            <div>
              <div class="flex items-center justify-between mb-1">
                <span class="text-sm text-muted">Memory Usage</span>
                <span class="text-sm font-medium text-highlighted">
                  {{ system.memory.usagePercent.toFixed(1) }}%
                </span>
              </div>
              <div class="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  class="h-full rounded-full transition-all duration-500"
                  :class="getUsageColor(system.memory.usagePercent)"
                  :style="{ width: `${Math.min(system.memory.usagePercent, 100)}%` }"
                />
              </div>
              <p class="text-xs text-muted mt-1">
                {{ formatBytes(system.memory.used) }} / {{ formatBytes(system.memory.total) }}
              </p>
            </div>

            <!-- Process Info -->
            <div class="pt-2 border-t border-default">
              <p class="text-xs text-muted">
                Process: {{ formatBytes(system.process.memoryUsed) }} heap ·
                {{ system.hostname }} ({{ system.platform }}/{{ system.arch }})
              </p>
            </div>
          </template>
        </div>
      </div>

      <!-- Cluster Nodes -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Cluster Nodes
          </h2>
          <UBadge
            v-if="cluster?.available"
            color="success"
            variant="subtle"
            label="Connected"
          />
          <UBadge
            v-else
            color="neutral"
            variant="subtle"
            label="Not Available"
          />
        </div>
        <div class="p-4">
          <template v-if="clusterStatus === 'pending'">
            <div
              v-for="i in 2"
              :key="i"
              class="flex items-center gap-3 p-3 rounded-lg bg-muted mb-2 last:mb-0"
            >
              <div class="size-8 rounded bg-default animate-pulse" />
              <div class="flex-1 space-y-2">
                <div class="h-4 w-24 bg-default rounded animate-pulse" />
                <div class="h-3 w-32 bg-default rounded animate-pulse" />
              </div>
            </div>
          </template>
          <template v-else-if="cluster?.available && cluster.nodes.items.length">
            <div class="space-y-2">
              <div
                v-for="node in cluster.nodes.items"
                :key="node.name"
                class="p-3 rounded-lg bg-muted"
              >
                <div class="flex items-center justify-between mb-2">
                  <div class="flex items-center gap-2">
                    <UIcon
                      name="i-lucide-hard-drive"
                      class="size-4 text-muted"
                    />
                    <span class="font-medium text-highlighted">{{ node.name }}</span>
                  </div>
                  <UBadge
                    :color="getStatusColor(node.status)"
                    :label="node.status"
                    variant="subtle"
                    size="sm"
                  />
                </div>
                <div
                  v-if="node.cpu || node.memory"
                  class="grid grid-cols-2 gap-4"
                >
                  <div v-if="node.cpu">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-muted">CPU</span>
                      <span class="text-highlighted">
                        {{ node.cpu.usagePercent !== undefined ? `${node.cpu.usagePercent.toFixed(1)}%` : 'N/A' }}
                      </span>
                    </div>
                    <div class="h-1.5 rounded-full bg-default overflow-hidden">
                      <div
                        v-if="node.cpu.usagePercent !== undefined"
                        class="h-full rounded-full transition-all duration-500"
                        :class="getUsageColor(node.cpu.usagePercent)"
                        :style="{ width: `${Math.min(node.cpu.usagePercent, 100)}%` }"
                      />
                    </div>
                  </div>
                  <div v-if="node.memory">
                    <div class="flex items-center justify-between text-xs mb-1">
                      <span class="text-muted">Memory</span>
                      <span class="text-highlighted">
                        {{ node.memory.usagePercent !== undefined ? `${node.memory.usagePercent.toFixed(1)}%` : 'N/A' }}
                      </span>
                    </div>
                    <div class="h-1.5 rounded-full bg-default overflow-hidden">
                      <div
                        v-if="node.memory.usagePercent !== undefined"
                        class="h-full rounded-full transition-all duration-500"
                        :class="getUsageColor(node.memory.usagePercent)"
                        :style="{ width: `${Math.min(node.memory.usagePercent, 100)}%` }"
                      />
                    </div>
                  </div>
                </div>
                <p
                  v-if="node.pods"
                  class="text-xs text-muted mt-2"
                >
                  {{ node.pods.running }} / {{ node.pods.capacity }} pods
                </p>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="text-center py-8">
              <UIcon
                name="i-lucide-hard-drive"
                class="size-8 text-muted mx-auto mb-2"
              />
              <p class="text-sm text-muted">
                {{ cluster?.available === false ? 'Kubernetes not configured' : 'No nodes in cluster' }}
              </p>
              <UButton
                to="/dashboard/nodes"
                variant="link"
                size="sm"
                label="Manage Nodes"
                class="mt-2"
              />
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- Databases & Apps Lists -->
    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Databases Health -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Databases
          </h2>
          <UButton
            to="/dashboard/databases"
            variant="link"
            color="neutral"
            label="View all"
            trailing-icon="i-lucide-arrow-right"
            size="sm"
          />
        </div>
        <div class="divide-y divide-default">
          <template v-if="databasesStatus === 'pending'">
            <div
              v-for="i in 3"
              :key="i"
              class="p-4"
            >
              <div class="flex items-center gap-3">
                <div class="size-8 rounded bg-muted animate-pulse" />
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-32 bg-muted rounded animate-pulse" />
                  <div class="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="databases?.items?.length">
            <div
              v-for="db in databases.items.slice(0, 5)"
              :key="db._id"
              class="flex items-center gap-3 p-4"
            >
              <div class="flex size-8 items-center justify-center rounded bg-muted">
                <UIcon
                  name="i-lucide-database"
                  class="size-4 text-muted"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ db.name }}
                </p>
                <p class="text-xs text-muted">
                  {{ db.type }} · {{ db.nodeCount }} node{{ db.nodeCount !== 1 ? 's' : '' }}
                </p>
              </div>
              <UBadge
                :color="getStatusColor(db.status)"
                :label="db.status"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <div
            v-else
            class="p-8 text-center"
          >
            <UIcon
              name="i-lucide-database"
              class="size-8 text-muted mx-auto mb-2"
            />
            <p class="text-sm text-muted">
              No databases provisioned
            </p>
            <UButton
              to="/dashboard/databases"
              variant="link"
              size="sm"
              label="Create Database"
              class="mt-2"
            />
          </div>
        </div>
      </div>

      <!-- Apps Health -->
      <div class="rounded-lg border border-default bg-elevated">
        <div class="flex items-center justify-between border-b border-default p-4">
          <h2 class="font-semibold text-highlighted">
            Apps
          </h2>
          <UButton
            to="/dashboard/apps"
            variant="link"
            color="neutral"
            label="View all"
            trailing-icon="i-lucide-arrow-right"
            size="sm"
          />
        </div>
        <div class="divide-y divide-default">
          <template v-if="appsStatus === 'pending'">
            <div
              v-for="i in 3"
              :key="i"
              class="p-4"
            >
              <div class="flex items-center gap-3">
                <div class="size-8 rounded bg-muted animate-pulse" />
                <div class="flex-1 space-y-2">
                  <div class="h-4 w-32 bg-muted rounded animate-pulse" />
                  <div class="h-3 w-24 bg-muted rounded animate-pulse" />
                </div>
              </div>
            </div>
          </template>
          <template v-else-if="apps?.items?.length">
            <div
              v-for="app in apps.items.slice(0, 5)"
              :key="app._id"
              class="flex items-center gap-3 p-4"
            >
              <div class="flex size-8 items-center justify-center rounded bg-muted">
                <UIcon
                  name="i-lucide-box"
                  class="size-4 text-muted"
                />
              </div>
              <div class="flex-1 min-w-0">
                <p class="font-medium text-highlighted truncate">
                  {{ app.name }}
                </p>
                <p class="text-xs text-muted">
                  {{ app.serverCount }} server{{ app.serverCount !== 1 ? 's' : '' }}
                </p>
              </div>
              <UBadge
                :color="getStatusColor(app.status)"
                :label="app.status"
                variant="subtle"
                size="sm"
              />
            </div>
          </template>
          <div
            v-else
            class="p-8 text-center"
          >
            <UIcon
              name="i-lucide-box"
              class="size-8 text-muted mx-auto mb-2"
            />
            <p class="text-sm text-muted">
              No apps deployed
            </p>
            <UButton
              to="/dashboard/apps"
              variant="link"
              size="sm"
              label="Deploy App"
              class="mt-2"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- Last Updated -->
    <p
      v-if="overview?.timestamp"
      class="text-xs text-center text-muted"
    >
      Last updated: {{ new Date(overview.timestamp).toLocaleTimeString() }}
      · Auto-refreshes every 30 seconds
    </p>
  </div>
</template>
