<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const route = useRoute()
const router = useRouter()
const toast = useToast()

const resourceId = computed(() => route.params.id as string)

const { getById, deleteById, getConnectionInfo, start, stop, restart, scale, getLogs, getEvents } = useAddon()

// Fetch resource data
const { data, status, refresh } = useLazyAsyncData(
  `resource-${resourceId.value}`,
  () => getById(resourceId.value),
  { immediate: true, server: false, watch: [resourceId] }
)

const resource = computed(() => data.value?.addon ?? null)
const loading = computed(() => status.value === 'pending')

// Catalog for icons and metadata
type TResourceCatalogItem = {
  type: TAddonType
  name: string
  icon: string
  iconColor: string
  category: string
}

const catalogMap: Record<string, TResourceCatalogItem> = {
  mongodb: { type: 'mongodb', name: 'MongoDB', icon: 'i-simple-icons-mongodb', iconColor: 'text-green-500', category: 'Databases' },
  postgresql: { type: 'postgresql', name: 'PostgreSQL', icon: 'i-simple-icons-postgresql', iconColor: 'text-blue-500', category: 'Databases' },
  mysql: { type: 'mysql', name: 'MySQL', icon: 'i-simple-icons-mysql', iconColor: 'text-orange-500', category: 'Databases' },
  mariadb: { type: 'mariadb', name: 'MariaDB', icon: 'i-simple-icons-mariadb', iconColor: 'text-amber-600', category: 'Databases' },
  clickhouse: { type: 'clickhouse', name: 'ClickHouse', icon: 'i-simple-icons-clickhouse', iconColor: 'text-yellow-500', category: 'Databases' },
  redis: { type: 'redis', name: 'Redis', icon: 'i-simple-icons-redis', iconColor: 'text-red-500', category: 'Caching' },
  keydb: { type: 'keydb', name: 'KeyDB', icon: 'i-lucide-database', iconColor: 'text-purple-500', category: 'Caching' },
  dragonfly: { type: 'dragonfly', name: 'Dragonfly', icon: 'i-lucide-zap', iconColor: 'text-green-400', category: 'Caching' },
  memcached: { type: 'memcached', name: 'Memcached', icon: 'i-lucide-memory-stick', iconColor: 'text-emerald-500', category: 'Caching' },
  elasticsearch: { type: 'elasticsearch', name: 'Elasticsearch', icon: 'i-simple-icons-elasticsearch', iconColor: 'text-yellow-400', category: 'Search' },
  meilisearch: { type: 'meilisearch', name: 'Meilisearch', icon: 'i-simple-icons-meilisearch', iconColor: 'text-pink-500', category: 'Search' },
  typesense: { type: 'typesense', name: 'Typesense', icon: 'i-lucide-search', iconColor: 'text-blue-400', category: 'Search' },
  rabbitmq: { type: 'rabbitmq', name: 'RabbitMQ', icon: 'i-simple-icons-rabbitmq', iconColor: 'text-orange-400', category: 'Queues' },
  nats: { type: 'nats', name: 'NATS', icon: 'i-lucide-send', iconColor: 'text-green-500', category: 'Queues' },
  kafka: { type: 'kafka', name: 'Kafka', icon: 'i-simple-icons-apachekafka', iconColor: 'text-gray-400', category: 'Queues' },
  minio: { type: 'minio', name: 'MinIO', icon: 'i-simple-icons-minio', iconColor: 'text-red-400', category: 'Storage' },
  seaweedfs: { type: 'seaweedfs', name: 'SeaweedFS', icon: 'i-lucide-hard-drive', iconColor: 'text-green-600', category: 'Storage' },
  grafana: { type: 'grafana', name: 'Grafana', icon: 'i-simple-icons-grafana', iconColor: 'text-orange-500', category: 'Monitoring' },
  prometheus: { type: 'prometheus', name: 'Prometheus', icon: 'i-simple-icons-prometheus', iconColor: 'text-red-600', category: 'Monitoring' },
  uptimekuma: { type: 'uptimekuma', name: 'Uptime Kuma', icon: 'i-lucide-activity', iconColor: 'text-green-400', category: 'Monitoring' },
  n8n: { type: 'n8n', name: 'n8n', icon: 'i-simple-icons-n8n', iconColor: 'text-red-500', category: 'Automation' },
  gitea: { type: 'gitea', name: 'Gitea', icon: 'i-simple-icons-gitea', iconColor: 'text-green-500', category: 'Development' },
  ghost: { type: 'ghost', name: 'Ghost', icon: 'i-simple-icons-ghost', iconColor: 'text-gray-400', category: 'CMS' },
  wordpress: { type: 'wordpress', name: 'WordPress', icon: 'i-simple-icons-wordpress', iconColor: 'text-blue-500', category: 'CMS' },
}

function getCatalogItem(type: TAddonType): TResourceCatalogItem {
  return catalogMap[type] || { type, name: type, icon: 'i-lucide-box', iconColor: 'text-gray-400', category: 'Other' }
}

const catalogItem = computed(() => resource.value ? getCatalogItem(resource.value.type) : null)

// Status colors and icons
const statusConfig: Record<string, { color: string, icon: string, label: string }> = {
  pending: { color: 'warning', icon: 'i-lucide-clock', label: 'Pending' },
  deploying: { color: 'info', icon: 'i-lucide-loader-2', label: 'Deploying' },
  running: { color: 'success', icon: 'i-lucide-check-circle', label: 'Running' },
  stopped: { color: 'neutral', icon: 'i-lucide-pause-circle', label: 'Stopped' },
  failed: { color: 'error', icon: 'i-lucide-x-circle', label: 'Failed' },
  deleting: { color: 'warning', icon: 'i-lucide-trash-2', label: 'Deleting' }
}

function getStatusConfig(s: TAddonStatus) {
  return statusConfig[s] || statusConfig.pending
}

// Tabs
const activeTab = ref('overview')
const tabs = [
  { value: 'overview', label: 'Overview', icon: 'i-lucide-info' },
  { value: 'logs', label: 'Logs', icon: 'i-lucide-terminal' },
  { value: 'events', label: 'Events', icon: 'i-lucide-bell' },
]

// Connection info modal
const dialogConnection = ref(false)
const connectionInfo = ref<TAddonConnectionInfo | null>(null)
const connectionString = ref<string | null>(null)
const loadingConnection = ref(false)

async function openConnectionInfo() {
  if (!resource.value) return
  loadingConnection.value = true
  dialogConnection.value = true
  
  try {
    const result = await getConnectionInfo(resource.value._id)
    connectionInfo.value = result.connectionInfo
    connectionString.value = result.connectionString || null
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to load connection info', color: 'error' })
  } finally {
    loadingConnection.value = false
  }
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text)
  toast.add({ title: 'Copied to clipboard', color: 'success', icon: 'i-lucide-check' })
}

// Actions
const actionLoading = ref<string | null>(null)

async function handleStart() {
  if (!resource.value) return
  actionLoading.value = 'start'
  try {
    await start(resource.value._id)
    toast.add({ title: 'Resource starting...', color: 'success', icon: 'i-lucide-play' })
    await refresh()
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to start', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

async function handleStop() {
  if (!resource.value) return
  actionLoading.value = 'stop'
  try {
    await stop(resource.value._id)
    toast.add({ title: 'Resource stopped', color: 'success', icon: 'i-lucide-pause' })
    await refresh()
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to stop', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

async function handleRestart() {
  if (!resource.value) return
  actionLoading.value = 'restart'
  try {
    await restart(resource.value._id)
    toast.add({ title: 'Resource restarting...', color: 'success', icon: 'i-lucide-rotate-cw' })
    await refresh()
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to restart', color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

// Scaling
const scalableTypes = ['mongodb', 'postgresql', 'mysql', 'mariadb', 'clickhouse', 'redis', 'keydb', 'dragonfly', 'elasticsearch']
const isScalable = computed(() => resource.value ? scalableTypes.includes(resource.value.type) : false)
const currentReplicas = computed(() => (resource.value?.config as any)?.replicas ?? 1)
const dialogScale = ref(false)
const scaleReplicas = ref(1)
const scaling = ref(false)

function openScaleDialog() {
  scaleReplicas.value = currentReplicas.value
  dialogScale.value = true
}

async function handleScale() {
  if (!resource.value) return
  scaling.value = true
  try {
    await scale(resource.value._id, scaleReplicas.value)
    toast.add({ title: `Scaling to ${scaleReplicas.value} replicas...`, color: 'success', icon: 'i-lucide-maximize' })
    dialogScale.value = false
    await refresh()
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to scale', color: 'error' })
  } finally {
    scaling.value = false
  }
}

// Delete modal
const dialogDelete = ref(false)
const deleting = ref(false)

async function handleDelete() {
  if (!resource.value) return
  deleting.value = true
  try {
    await deleteById(resource.value._id)
    toast.add({ title: 'Resource deleted', color: 'success', icon: 'i-lucide-trash-2' })
    router.push('/resources')
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to delete', color: 'error' })
  } finally {
    deleting.value = false
    dialogDelete.value = false
  }
}

// Logs
const logs = ref<string[]>([])
const logsLoading = ref(false)
const logsTailLines = ref(100)

async function fetchLogs() {
  if (!resource.value) return
  logsLoading.value = true
  try {
    const result = await getLogs(resource.value._id, { tailLines: logsTailLines.value })
    logs.value = result.logs
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to load logs', color: 'error' })
    logs.value = []
  } finally {
    logsLoading.value = false
  }
}

watch(activeTab, (tab) => {
  if (tab === 'logs' && logs.value.length === 0) {
    fetchLogs()
  }
  if (tab === 'events' && events.value.length === 0) {
    fetchEvents()
  }
})

// Events
const events = ref<TK8sEvent[]>([])
const eventsLoading = ref(false)

async function fetchEvents() {
  if (!resource.value) return
  eventsLoading.value = true
  try {
    const result = await getEvents(resource.value._id)
    events.value = result.events
  } catch (err: any) {
    toast.add({ title: err.message || 'Failed to load events', color: 'error' })
    events.value = []
  } finally {
    eventsLoading.value = false
  }
}

function getEventTypeColor(type: string) {
  return type === 'Warning' ? 'warning' : type === 'Normal' ? 'success' : 'neutral'
}

function formatEventTime(timestamp: string | undefined) {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString()
}

// Auto-refresh when deploying
const refreshInterval = ref<ReturnType<typeof setInterval> | null>(null)

watch(() => resource.value?.status, (newStatus) => {
  if (newStatus === 'deploying' && !refreshInterval.value) {
    refreshInterval.value = setInterval(() => refresh(), 5000)
  } else if (newStatus !== 'deploying' && refreshInterval.value) {
    clearInterval(refreshInterval.value)
    refreshInterval.value = null
  }
}, { immediate: true })

onUnmounted(() => {
  if (refreshInterval.value) {
    clearInterval(refreshInterval.value)
  }
})

useHead({
  title: computed(() => resource.value ? `${resource.value.name} - Resources` : 'Resource Details')
})
</script>

<template>
  <div class="max-w-5xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-start justify-between">
      <div class="flex items-center gap-4">
        <UButton
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          to="/resources"
        />
        
        <div v-if="loading" class="flex items-center gap-3">
          <USkeleton class="size-12 rounded-lg" />
          <div>
            <USkeleton class="h-6 w-40" />
            <USkeleton class="h-4 w-24 mt-1" />
          </div>
        </div>
        
        <div v-else-if="resource && catalogItem" class="flex items-center gap-3">
          <div
            :class="[
              catalogItem.iconColor,
              'flex size-12 items-center justify-center rounded-lg bg-default/50 border border-default'
            ]"
          >
            <UIcon :name="catalogItem.icon" class="size-6" />
          </div>
          <div>
            <h1 class="text-2xl font-bold text-highlighted">
              {{ resource.name }}
            </h1>
            <p class="text-muted text-sm">
              {{ catalogItem.name }} · {{ catalogItem.category }}
            </p>
          </div>
        </div>
      </div>
      
      <div v-if="resource" class="flex items-center gap-2">
        <UBadge
          :color="(getStatusConfig(resource.status)?.color ?? 'neutral') as any"
          variant="subtle"
          size="lg"
        >
          <UIcon
            :name="getStatusConfig(resource.status)?.icon ?? 'i-lucide-clock'"
            :class="resource.status === 'deploying' ? 'animate-spin' : ''"
            class="size-4 mr-1"
          />
          {{ getStatusConfig(resource.status)?.label ?? resource.status }}
        </UBadge>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading" class="space-y-6">
      <USkeleton class="h-40 w-full rounded-lg" />
      <USkeleton class="h-60 w-full rounded-lg" />
    </div>

    <!-- Not found -->
    <div
      v-else-if="!resource"
      class="flex flex-col items-center justify-center py-20 text-center"
    >
      <UIcon name="i-lucide-alert-circle" class="size-12 text-muted mb-4" />
      <p class="text-lg font-medium text-highlighted">Resource not found</p>
      <p class="text-muted mt-1">The resource you're looking for doesn't exist.</p>
      <UButton
        to="/resources"
        color="primary"
        class="mt-4"
      >
        Back to Resources
      </UButton>
    </div>

    <!-- Resource details -->
    <template v-else>
      <!-- Actions card -->
      <UCard>
        <template #header>
          <h2 class="font-semibold">Actions</h2>
        </template>
        
        <div class="flex flex-wrap gap-3">
          <UButton
            v-if="resource.status === 'stopped'"
            icon="i-lucide-play"
            color="success"
            :loading="actionLoading === 'start'"
            @click="handleStart"
          >
            Start
          </UButton>
          
          <UButton
            v-if="resource.status === 'running'"
            icon="i-lucide-pause"
            color="warning"
            :loading="actionLoading === 'stop'"
            @click="handleStop"
          >
            Stop
          </UButton>
          
          <UButton
            v-if="['running', 'failed'].includes(resource.status)"
            icon="i-lucide-rotate-cw"
            color="neutral"
            variant="outline"
            :loading="actionLoading === 'restart'"
            @click="handleRestart"
          >
            Restart
          </UButton>
          
          <UButton
            v-if="isScalable && resource.status === 'running'"
            icon="i-lucide-maximize"
            color="neutral"
            variant="outline"
            @click="openScaleDialog"
          >
            Scale ({{ currentReplicas }})
          </UButton>
          
          <UButton
            icon="i-lucide-link"
            color="neutral"
            variant="outline"
            :disabled="resource.status !== 'running'"
            @click="openConnectionInfo"
          >
            Connection Info
          </UButton>
          
          <UButton
            icon="i-lucide-refresh-cw"
            color="neutral"
            variant="ghost"
            :loading="status === 'pending'"
            @click="() => refresh()"
          >
            Refresh
          </UButton>
          
          <div class="flex-1" />
          
          <UButton
            icon="i-lucide-trash-2"
            color="error"
            variant="ghost"
            @click="dialogDelete = true"
          >
            Delete
          </UButton>
        </div>
      </UCard>

      <!-- Tabs -->
      <div class="flex items-center gap-1 border-b border-default">
        <button
          v-for="tab in tabs"
          :key="tab.value"
          :class="[
            'flex items-center gap-2 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors',
            activeTab === tab.value
              ? 'border-primary text-primary'
              : 'border-transparent text-muted hover:text-highlighted'
          ]"
          @click="activeTab = tab.value"
        >
          <UIcon :name="tab.icon" class="size-4" />
          {{ tab.label }}
        </button>
      </div>

      <!-- Overview Tab -->
      <template v-if="activeTab === 'overview'">
        <!-- Overview card -->
        <UCard>
          <template #header>
            <h2 class="font-semibold">Details</h2>
          </template>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="space-y-4">
              <div>
                <p class="text-xs text-muted uppercase tracking-wide">Release Name</p>
                <p class="text-highlighted font-mono text-sm mt-1">{{ resource.releaseName || '-' }}</p>
              </div>
              
              <div>
                <p class="text-xs text-muted uppercase tracking-wide">Namespace</p>
                <p class="text-highlighted font-mono text-sm mt-1">{{ resource.namespace }}</p>
              </div>
              
              <div>
                <p class="text-xs text-muted uppercase tracking-wide">Version</p>
                <p class="text-highlighted text-sm mt-1">{{ resource.version || '-' }}</p>
              </div>
              
              <div v-if="isScalable">
                <p class="text-xs text-muted uppercase tracking-wide">Replicas</p>
                <p class="text-highlighted text-sm mt-1">{{ currentReplicas }}</p>
              </div>
            </div>
            
            <div class="space-y-4">
              <div>
                <p class="text-xs text-muted uppercase tracking-wide">Created</p>
                <p class="text-highlighted text-sm mt-1">
                  {{ resource.createdAt ? new Date(resource.createdAt).toLocaleString() : '-' }}
                </p>
              </div>
              
              <div>
                <p class="text-xs text-muted uppercase tracking-wide">Last Updated</p>
                <p class="text-highlighted text-sm mt-1">
                  {{ resource.updatedAt ? new Date(resource.updatedAt).toLocaleString() : '-' }}
                </p>
              </div>
              
              <div v-if="resource.lastError">
                <p class="text-xs text-muted uppercase tracking-wide">Last Error</p>
                <p class="text-error text-sm mt-1 font-mono">{{ resource.lastError }}</p>
              </div>
            </div>
          </div>
        </UCard>

        <!-- Quick Connection Info (when running) -->
        <UCard v-if="resource.status === 'running' && resource.connectionInfo">
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Connection</h2>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-external-link"
                @click="openConnectionInfo"
              >
                View All
              </UButton>
            </div>
          </template>
          
          <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p class="text-xs text-muted uppercase tracking-wide">Host</p>
              <div class="flex items-center gap-2 mt-1">
                <code class="text-sm bg-muted px-2 py-1 rounded font-mono truncate flex-1">
                  {{ resource.connectionInfo.host }}
                </code>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(resource.connectionInfo?.host || '')"
                />
              </div>
            </div>
            
            <div>
              <p class="text-xs text-muted uppercase tracking-wide">Port</p>
              <div class="flex items-center gap-2 mt-1">
                <code class="text-sm bg-muted px-2 py-1 rounded font-mono">
                  {{ resource.connectionInfo.port }}
                </code>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(String(resource.connectionInfo?.port || ''))"
                />
              </div>
            </div>
            
            <div v-if="resource.connectionInfo.username">
              <p class="text-xs text-muted uppercase tracking-wide">Username</p>
              <div class="flex items-center gap-2 mt-1">
                <code class="text-sm bg-muted px-2 py-1 rounded font-mono">
                  {{ resource.connectionInfo.username }}
                </code>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(resource.connectionInfo?.username || '')"
                />
              </div>
            </div>
          </div>
        </UCard>

        <!-- Configuration card -->
        <UCard v-if="resource.config && Object.keys(resource.config).length > 0">
          <template #header>
            <h2 class="font-semibold">Configuration</h2>
          </template>
          
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div v-for="(value, key) in resource.config" :key="key">
              <p class="text-xs text-muted uppercase tracking-wide">{{ key }}</p>
              <p class="text-highlighted text-sm mt-1">
                <template v-if="typeof value === 'boolean'">
                  <UBadge :color="value ? 'success' : 'neutral'" size="xs">
                    {{ value ? 'Enabled' : 'Disabled' }}
                  </UBadge>
                </template>
                <template v-else-if="String(key).toLowerCase().includes('password')">
                  ****
                </template>
                <template v-else>
                  {{ value }}
                </template>
              </p>
            </div>
          </div>
        </UCard>
      </template>

      <!-- Logs Tab -->
      <template v-if="activeTab === 'logs'">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Pod Logs</h2>
              <div class="flex items-center gap-2">
                <USelect
                  v-model="logsTailLines"
                  :items="[
                    { value: 50, label: 'Last 50 lines' },
                    { value: 100, label: 'Last 100 lines' },
                    { value: 500, label: 'Last 500 lines' },
                    { value: 1000, label: 'Last 1000 lines' },
                  ]"
                  size="xs"
                  class="w-40"
                />
                <UButton
                  icon="i-lucide-refresh-cw"
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  :loading="logsLoading"
                  @click="fetchLogs"
                />
              </div>
            </div>
          </template>

          <div v-if="logsLoading" class="space-y-2">
            <USkeleton class="h-4 w-full" />
            <USkeleton class="h-4 w-3/4" />
            <USkeleton class="h-4 w-5/6" />
            <USkeleton class="h-4 w-2/3" />
          </div>

          <div
            v-else-if="logs.length === 0"
            class="text-center py-8"
          >
            <UIcon name="i-lucide-terminal" class="size-8 text-muted mb-2" />
            <p class="text-muted">No logs available</p>
            <p class="text-xs text-muted mt-1">Logs will appear when the resource is running</p>
          </div>

          <div v-else class="space-y-4">
            <div
              v-for="(log, index) in logs"
              :key="index"
              class="bg-gray-900 rounded-lg p-4 overflow-x-auto"
            >
              <pre class="text-xs text-green-400 font-mono whitespace-pre-wrap">{{ log }}</pre>
            </div>
          </div>
        </UCard>
      </template>

      <!-- Events Tab -->
      <template v-if="activeTab === 'events'">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Kubernetes Events</h2>
              <UButton
                icon="i-lucide-refresh-cw"
                size="xs"
                color="neutral"
                variant="ghost"
                :loading="eventsLoading"
                @click="fetchEvents"
              />
            </div>
          </template>

          <div v-if="eventsLoading" class="space-y-3">
            <USkeleton class="h-16 w-full rounded-lg" />
            <USkeleton class="h-16 w-full rounded-lg" />
            <USkeleton class="h-16 w-full rounded-lg" />
          </div>

          <div
            v-else-if="events.length === 0"
            class="text-center py-8"
          >
            <UIcon name="i-lucide-bell-off" class="size-8 text-muted mb-2" />
            <p class="text-muted">No events found</p>
            <p class="text-xs text-muted mt-1">Events will appear when Kubernetes reports activity</p>
          </div>

          <div v-else class="space-y-3">
            <div
              v-for="(event, index) in events"
              :key="index"
              class="rounded-lg border border-default p-4"
            >
              <div class="flex items-start justify-between gap-4">
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <UBadge
                      :color="getEventTypeColor(event.type) as any"
                      size="xs"
                    >
                      {{ event.type }}
                    </UBadge>
                    <span class="font-medium text-sm text-highlighted">{{ event.reason }}</span>
                    <span v-if="event.count && event.count > 1" class="text-xs text-muted">
                      ({{ event.count }}x)
                    </span>
                  </div>
                  <p class="text-sm text-muted mt-1">{{ event.message }}</p>
                  <div v-if="event.involvedObject" class="text-xs text-muted mt-2">
                    {{ event.involvedObject.kind }}: {{ event.involvedObject.name }}
                  </div>
                </div>
                <div class="text-xs text-muted text-right shrink-0">
                  {{ formatEventTime(event.lastTimestamp) }}
                </div>
              </div>
            </div>
          </div>
        </UCard>
      </template>
    </template>

    <!-- Connection Info Modal -->
    <UModal v-model:open="dialogConnection">
      <template #header>
        <div class="flex items-center gap-3">
          <div
            v-if="catalogItem"
            :class="[
              catalogItem.iconColor,
              'flex size-10 items-center justify-center rounded-lg bg-default/50 border border-default'
            ]"
          >
            <UIcon :name="catalogItem.icon" class="size-5" />
          </div>
          <div>
            <h3 class="text-lg font-semibold">
              Connection Info
            </h3>
            <p class="text-sm text-muted">
              {{ resource?.name }}
            </p>
          </div>
        </div>
      </template>

      <template #body>
        <div class="p-6">
          <div
            v-if="loadingConnection"
            class="space-y-4"
          >
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-10 w-full" />
            <USkeleton class="h-16 w-full" />
          </div>
          
          <div
            v-else-if="connectionInfo"
            class="space-y-4"
          >
            <!-- Host & Port -->
            <div class="grid grid-cols-2 gap-4">
              <UFormField label="Host">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono truncate">
                    {{ connectionInfo.host }}
                  </code>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyToClipboard(connectionInfo?.host || '')"
                  />
                </div>
              </UFormField>

              <UFormField label="Port">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    {{ connectionInfo.port }}
                  </code>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyToClipboard(String(connectionInfo?.port))"
                  />
                </div>
              </UFormField>
            </div>

            <!-- Username & Password -->
            <div
              v-if="connectionInfo.username || connectionInfo.password"
              class="grid grid-cols-2 gap-4"
            >
              <UFormField v-if="connectionInfo.username" label="Username">
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    {{ connectionInfo.username }}
                  </code>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyToClipboard(connectionInfo?.username || '')"
                  />
                </div>
              </UFormField>

              <UFormField
                v-if="connectionInfo.password"
                label="Password"
              >
                <div class="flex items-center gap-2">
                  <code class="flex-1 text-sm bg-muted px-3 py-2 rounded font-mono">
                    {{ connectionInfo.password }}
                  </code>
                  <UButton
                    size="xs"
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-copy"
                    @click="copyToClipboard(connectionInfo?.password || '')"
                  />
                </div>
              </UFormField>
            </div>

            <!-- Connection String -->
            <UFormField
              v-if="connectionString"
              label="Connection String"
            >
              <div class="flex items-center gap-2">
                <code class="flex-1 text-xs bg-muted px-3 py-2 rounded font-mono break-all">
                  {{ connectionString }}
                </code>
                <UButton
                  size="xs"
                  color="neutral"
                  variant="ghost"
                  icon="i-lucide-copy"
                  @click="copyToClipboard(connectionString || '')"
                />
              </div>
            </UFormField>

            <UAlert
              color="info"
              icon="i-lucide-info"
              title="Internal DNS"
              description="This hostname is only accessible from within the Kubernetes cluster."
            />
          </div>
          
          <div
            v-else
            class="flex flex-col items-center justify-center py-8"
          >
            <UIcon name="i-lucide-alert-circle" class="size-8 text-muted mb-2" />
            <p class="text-muted">
              Connection info not available
            </p>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          @click="dialogConnection = false"
        >
          Close
        </UButton>
      </template>
    </UModal>

    <!-- Scale Modal -->
    <UModal v-model:open="dialogScale">
      <template #header>
        <h3 class="text-lg font-semibold">
          Scale Resource
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <p class="text-muted">
            Adjust the number of replicas for <span class="font-medium text-highlighted">{{ resource?.name }}</span>.
          </p>
          
          <UFormField label="Replicas">
            <USelect
              v-model="scaleReplicas"
              :items="[
                { value: 1, label: '1 replica (standalone)' },
                { value: 3, label: '3 replicas (recommended)' },
                { value: 5, label: '5 replicas' },
                { value: 7, label: '7 replicas' },
              ]"
            />
          </UFormField>

          <UAlert
            v-if="scaleReplicas > currentReplicas"
            color="info"
            icon="i-lucide-info"
            description="Scaling up will provision additional pods. This may take a few minutes."
          />
          
          <UAlert
            v-if="scaleReplicas < currentReplicas"
            color="warning"
            icon="i-lucide-alert-triangle"
            description="Scaling down will remove pods. Data may be lost if not using persistent storage."
          />
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          @click="dialogScale = false"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          :loading="scaling"
          :disabled="scaleReplicas === currentReplicas"
          @click="handleScale"
        >
          Scale to {{ scaleReplicas }} {{ scaleReplicas === 1 ? 'replica' : 'replicas' }}
        </UButton>
      </template>
    </UModal>

    <!-- Delete Confirmation Modal -->
    <UModal v-model:open="dialogDelete">
      <template #header>
        <h3 class="text-lg font-semibold">
          Delete Resource
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
                <span class="font-medium text-highlighted">{{ resource?.name }}</span>?
              </p>
              <p class="text-sm text-muted mt-2">
                This will uninstall the Helm release and delete all associated data. This action cannot be undone.
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="outline"
          @click="dialogDelete = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleting"
          @click="handleDelete"
        >
          Delete
        </UButton>
      </template>
    </UModal>
  </div>
</template>
