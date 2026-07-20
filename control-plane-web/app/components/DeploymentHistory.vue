<script setup lang="ts">
/**
 * DeploymentHistory — clickable list of past runs.
 * Clicking a run emits `select` so the parent can show its log in the
 * main ProvisionLog viewer. No inline expand/collapse.
 */
const props = defineProps<{
  resourceId: string
  resourceType: 'app' | 'db'
  activeId?: string | null
}>()

const emit = defineEmits<{
  select: [deployment: { _id: string; status: string; logs?: string; startedAt?: string; completedAt?: string; image?: string }]
}>()

const { getLogs: getDbLogs } = useDatabase()
const { getDeployments: getAppDeployments } = useApp()

type TDeploymentEntry = {
  _id: string
  status: 'pending' | 'running' | 'success' | 'failed'
  logs?: string
  startedAt?: string
  completedAt?: string
  image?: string
}

const deployments = ref<TDeploymentEntry[]>([])
const loading = ref(false)
// Track if we've done initial load (to show skeleton only on first load)
const initialized = ref(false)

async function load() {
  loading.value = true
  try {
    let items: TDeploymentEntry[] = []
    if (props.resourceType === 'db') {
      const data = await getDbLogs(props.resourceId)
      items = data.deployments ?? []
    } else {
      const data = await getAppDeployments(props.resourceId)
      items = data.deployments ?? []
    }
    // Merge new items with existing to avoid flicker
    // New items at the front, update existing items in place
    mergeDeployments(items)
    initialized.value = true
  } catch {
    if (!initialized.value) {
      deployments.value = []
    }
  } finally {
    loading.value = false
  }
}

/** Merge fetched items into existing array to minimize re-renders */
function mergeDeployments(items: TDeploymentEntry[]) {
  const existingIds = new Set(deployments.value.map(d => d._id))
  const newItems: TDeploymentEntry[] = []

  for (const item of items) {
    if (existingIds.has(item._id)) {
      // Update existing item in place
      const idx = deployments.value.findIndex(d => d._id === item._id)
      if (idx !== -1) {
        Object.assign(deployments.value[idx], item)
      }
    } else {
      // New item
      newItems.push(item)
    }
  }

  // Prepend new items (they're typically the most recent)
  if (newItems.length > 0) {
    deployments.value = [...newItems, ...deployments.value]
  }

  // Remove items that no longer exist (optional, usually not needed)
  const fetchedIds = new Set(items.map(i => i._id))
  deployments.value = deployments.value.filter(d => fetchedIds.has(d._id))
}

/** Add a placeholder entry when provisioning starts (before API creates the record) */
function addRunningEntry() {
  const placeholder: TDeploymentEntry = {
    _id: `temp-${Date.now()}`,
    status: 'running',
    startedAt: new Date().toISOString(),
  }
  deployments.value = [placeholder, ...deployments.value]
  return placeholder._id
}

/** Update the first running entry's status when done */
function updateLatestStatus(status: 'success' | 'failed') {
  const running = deployments.value.find(d => d.status === 'running')
  if (running) {
    running.status = status
    running.completedAt = new Date().toISOString()
  }
}

function statusColor(s: string) {
  return s === 'success' ? 'success' : s === 'failed' ? 'error' : s === 'running' ? 'warning' : 'neutral'
}

function statusIcon(s: string) {
  return s === 'success' ? 'i-lucide-check-circle' : s === 'failed' ? 'i-lucide-x-circle' : s === 'running' ? 'i-lucide-loader-2' : 'i-lucide-clock'
}

function formatDate(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : '—'
}

function duration(start?: string, end?: string) {
  if (!start || !end) return null
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  return `${Math.round(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`
}

onMounted(load)

defineExpose({ load, addRunningEntry, updateLatestStatus })
</script>

<template>
  <div class="rounded-xl border border-default bg-elevated/50 overflow-hidden">
    <div class="flex items-center justify-between px-5 py-4 border-b border-default">
      <h2 class="text-base font-semibold text-highlighted">
        {{ resourceType === 'app' ? 'Deployment' : 'Provisioning' }} History
      </h2>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="ghost"
        size="sm"
        :loading="loading"
        @click="load"
      />
    </div>

    <!-- Empty state: show after initialization if no deployments -->
    <div
      v-if="initialized && !deployments.length"
      class="flex flex-col items-center justify-center py-10 text-center"
    >
      <UIcon
        name="i-lucide-history"
        class="size-8 text-muted mb-2"
      />
      <p class="text-sm text-muted">
        No {{ resourceType === 'app' ? 'deployment' : 'provisioning' }} runs yet.
      </p>
    </div>

    <!-- Only show skeleton on initial load, not on refresh -->
    <div
      v-else-if="!initialized && loading"
      class="divide-y divide-default"
    >
      <div
        v-for="n in 3"
        :key="n"
        class="flex items-center gap-3 px-5 py-3"
      >
        <USkeleton class="size-4 rounded-full shrink-0" />
        <USkeleton class="h-4 w-32" />
        <USkeleton class="h-4 w-20 ml-auto" />
      </div>
    </div>

    <div
      v-else
      class="divide-y divide-default max-h-80 overflow-y-auto"
    >
      <button
        v-for="dep in deployments"
        :key="dep._id"
        class="w-full flex items-center gap-3 px-5 py-3 text-left transition-colors"
        :class="activeId === dep._id ? 'bg-primary/10 border-l-2 border-l-primary' : 'hover:bg-elevated/80'"
        @click="emit('select', dep)"
      >
        <UIcon
          :name="statusIcon(dep.status)"
          class="size-4 shrink-0"
          :class="{
            'text-success': dep.status === 'success',
            'text-error': dep.status === 'failed',
            'text-warning animate-spin': dep.status === 'running',
            'text-muted': dep.status === 'pending',
          }"
        />

        <div class="flex-1 min-w-0">
          <p class="text-sm font-medium text-highlighted truncate">
            {{ dep.image || (resourceType === 'app' ? 'Deployment run' : 'Provisioning run') }}
          </p>
          <p class="text-xs text-muted">
            {{ formatDate(dep.startedAt) }}
            <span
              v-if="duration(dep.startedAt, dep.completedAt)"
              class="ml-2"
            >· {{ duration(dep.startedAt, dep.completedAt) }}</span>
          </p>
        </div>

        <UBadge
          :color="statusColor(dep.status)"
          :label="dep.status"
          variant="subtle"
          size="xs"
          class="shrink-0"
        />
      </button>
    </div>
  </div>
</template>
