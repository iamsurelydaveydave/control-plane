<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Alerts page — list alerts with filters and quick actions.
 * Auto-refreshes every 30 seconds.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getAll, acknowledge, resolve } = useAlerts()

// Pagination
const page = ref(1)
const pageSize = 20

// Filters
const selectedSeverity = ref<TAlertSeverity | 'all'>('all')
const selectedStatus = ref<TAlertStatus | 'all'>('all')
const selectedSource = ref<TAlertSource | 'all'>('all')
const search = ref('')

const severityOptions = [
  { label: 'All Severities', value: 'all' },
  { label: 'Info', value: 'info' },
  { label: 'Warning', value: 'warning' },
  { label: 'Critical', value: 'critical' }
]

const statusOptions = [
  { label: 'All Statuses', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Acknowledged', value: 'acknowledged' },
  { label: 'Resolved', value: 'resolved' }
]

const sourceOptions = [
  { label: 'All Sources', value: 'all' },
  { label: 'System', value: 'system' },
  { label: 'Database', value: 'database' },
  { label: 'App', value: 'app' },
  { label: 'Cluster', value: 'cluster' },
  { label: 'Node', value: 'node' }
]

// Auto-refresh
const refreshInterval = 30000 // 30 seconds
let refreshTimer: ReturnType<typeof setInterval> | null = null

// Fetch alerts
const { data, status, refresh } = useLazyAsyncData(
  'alerts',
  () => getAll({
    page: page.value,
    severity: selectedSeverity.value === 'all' ? undefined : selectedSeverity.value,
    status: selectedStatus.value === 'all' ? undefined : selectedStatus.value,
    source: selectedSource.value === 'all' ? undefined : selectedSource.value,
    search: search.value
  }),
  { immediate: true, server: false }
)

const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => data.value?.pages ?? 1)
const loading = computed(() => status.value === 'pending')

// Reset page and refresh when filters change
watch([selectedSeverity, selectedStatus, selectedSource], () => {
  page.value = 1
  refresh()
})

// Debounced search
let searchTimeout: ReturnType<typeof setTimeout> | null = null
watch(search, () => {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    page.value = 1
    refresh()
  }, 300)
})

watch(page, () => refresh())

// Setup auto-refresh
onMounted(() => {
  refreshTimer = setInterval(refresh, refreshInterval)
})

onUnmounted(() => {
  if (refreshTimer) clearInterval(refreshTimer)
  if (searchTimeout) clearTimeout(searchTimeout)
})

// Table columns
const columns: TableColumn<TAlert>[] = [
  { accessorKey: 'severity', header: 'Severity' },
  { accessorKey: 'title', header: 'Alert' },
  { accessorKey: 'source', header: 'Source' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'Time' },
  { id: 'actions' }
]

// Actions
const actionLoading = ref<string | null>(null)
const toast = useToast()

async function handleAcknowledge(alert: TAlert) {
  actionLoading.value = `ack-${alert._id}`
  try {
    await acknowledge(alert._id)
    toast.add({ title: 'Alert acknowledged', color: 'success' })
    refresh()
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Failed to acknowledge alert', description: error.message, color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

async function handleResolve(alert: TAlert) {
  actionLoading.value = `resolve-${alert._id}`
  try {
    await resolve(alert._id)
    toast.add({ title: 'Alert resolved', color: 'success' })
    refresh()
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Failed to resolve alert', description: error.message, color: 'error' })
  } finally {
    actionLoading.value = null
  }
}

// Detail modal
const selectedAlert = ref<TAlert | null>(null)
const openDetail = ref(false)

function viewDetails(alert: TAlert) {
  selectedAlert.value = alert
  openDetail.value = true
}

// Helpers
function getSeverityColor(severity: TAlertSeverity): 'info' | 'warning' | 'error' {
  switch (severity) {
    case 'info': return 'info'
    case 'warning': return 'warning'
    case 'critical': return 'error'
  }
}

function getStatusColor(status: TAlertStatus): 'error' | 'warning' | 'success' {
  switch (status) {
    case 'active': return 'error'
    case 'acknowledged': return 'warning'
    case 'resolved': return 'success'
  }
}

function getSourceIcon(source: TAlertSource): string {
  switch (source) {
    case 'system': return 'i-lucide-monitor'
    case 'database': return 'i-lucide-database'
    case 'app': return 'i-lucide-box'
    case 'cluster': return 'i-lucide-layers'
    case 'node': return 'i-lucide-hard-drive'
  }
}

function formatTime(date: string): string {
  return new Date(date).toLocaleString()
}

function formatRelativeTime(date: string): string {
  const now = Date.now()
  const then = new Date(date).getTime()
  const diff = now - then

  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

useHead({ title: 'Alerts' })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Alerts
        </h1>
        <p class="text-muted">
          Monitor and manage system alerts
        </p>
      </div>
      <UButton
        icon="i-lucide-refresh-cw"
        color="neutral"
        variant="outline"
        :loading="loading"
        @click="refresh()"
      >
        Refresh
      </UButton>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <UInput
        v-model="search"
        placeholder="Search alerts..."
        icon="i-lucide-search"
        class="w-full sm:w-64"
      />
      <USelectMenu
        v-model="selectedSeverity"
        :items="severityOptions"
        value-key="value"
        class="w-full sm:w-40"
      />
      <USelectMenu
        v-model="selectedStatus"
        :items="statusOptions"
        value-key="value"
        class="w-full sm:w-40"
      />
      <USelectMenu
        v-model="selectedSource"
        :items="sourceOptions"
        value-key="value"
        class="w-full sm:w-40"
      />
    </div>

    <!-- Alerts Table -->
    <UCard>
      <UTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :empty-state="{ icon: 'i-lucide-bell-off', label: 'No alerts found' }"
      >
        <template #severity-cell="{ row }">
          <UBadge
            :color="getSeverityColor(row.original.severity)"
            variant="subtle"
            class="capitalize"
          >
            {{ row.original.severity }}
          </UBadge>
        </template>

        <template #title-cell="{ row }">
          <div class="max-w-md">
            <p class="font-medium text-highlighted truncate">
              {{ row.original.title }}
            </p>
            <p class="text-xs text-muted truncate">
              {{ row.original.message }}
            </p>
          </div>
        </template>

        <template #source-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon
              :name="getSourceIcon(row.original.source)"
              class="size-4 text-muted"
            />
            <span class="capitalize">{{ row.original.source }}</span>
          </div>
        </template>

        <template #status-cell="{ row }">
          <UBadge
            :color="getStatusColor(row.original.status)"
            variant="soft"
            class="capitalize"
          >
            {{ row.original.status }}
          </UBadge>
        </template>

        <template #createdAt-cell="{ row }">
          <span
            class="text-sm text-muted"
            :title="formatTime(row.original.createdAt)"
          >
            {{ formatRelativeTime(row.original.createdAt) }}
          </span>
        </template>

        <template #actions-cell="{ row }">
          <div class="flex items-center justify-end gap-1">
            <UButton
              icon="i-lucide-eye"
              color="neutral"
              variant="ghost"
              size="sm"
              square
              @click="viewDetails(row.original)"
            />
            <UButton
              v-if="row.original.status === 'active'"
              icon="i-lucide-check"
              color="warning"
              variant="ghost"
              size="sm"
              square
              :loading="actionLoading === `ack-${row.original._id}`"
              title="Acknowledge"
              @click="handleAcknowledge(row.original)"
            />
            <UButton
              v-if="row.original.status !== 'resolved'"
              icon="i-lucide-check-check"
              color="success"
              variant="ghost"
              size="sm"
              square
              :loading="actionLoading === `resolve-${row.original._id}`"
              title="Resolve"
              @click="handleResolve(row.original)"
            />
          </div>
        </template>
      </UTable>

      <!-- Pagination -->
      <div
        v-if="totalPages > 1"
        class="flex justify-end border-t border-default p-3"
      >
        <UPagination
          v-model:page="page"
          :total="totalPages * pageSize"
          :page-size="pageSize"
        />
      </div>
    </UCard>

    <!-- Auto-refresh indicator -->
    <p class="text-center text-xs text-muted">
      Auto-refreshing every {{ refreshInterval / 1000 }} seconds
    </p>

    <!-- Detail Modal -->
    <UModal v-model:open="openDetail">
      <template #content>
        <div
          v-if="selectedAlert"
          class="p-4 space-y-4"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-center gap-3">
              <div
                :class="[
                  'flex size-10 items-center justify-center rounded-lg',
                  selectedAlert.severity === 'critical' ? 'bg-error/10' : '',
                  selectedAlert.severity === 'warning' ? 'bg-warning/10' : '',
                  selectedAlert.severity === 'info' ? 'bg-info/10' : ''
                ]"
              >
                <UIcon
                  name="i-lucide-alert-triangle"
                  :class="[
                    'size-5',
                    selectedAlert.severity === 'critical' ? 'text-error' : '',
                    selectedAlert.severity === 'warning' ? 'text-warning' : '',
                    selectedAlert.severity === 'info' ? 'text-info' : ''
                  ]"
                />
              </div>
              <div>
                <h3 class="font-semibold text-highlighted">
                  {{ selectedAlert.title }}
                </h3>
                <div class="flex items-center gap-2 mt-1">
                  <UBadge
                    :color="getSeverityColor(selectedAlert.severity)"
                    variant="subtle"
                    size="xs"
                    class="capitalize"
                  >
                    {{ selectedAlert.severity }}
                  </UBadge>
                  <UBadge
                    :color="getStatusColor(selectedAlert.status)"
                    variant="soft"
                    size="xs"
                    class="capitalize"
                  >
                    {{ selectedAlert.status }}
                  </UBadge>
                </div>
              </div>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <p class="text-xs text-muted mb-1">
                Message
              </p>
              <p class="text-sm text-default">
                {{ selectedAlert.message }}
              </p>
            </div>

            <div class="grid grid-cols-2 gap-3">
              <div>
                <p class="text-xs text-muted mb-1">
                  Source
                </p>
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="getSourceIcon(selectedAlert.source)"
                    class="size-4 text-muted"
                  />
                  <span class="text-sm text-default capitalize">{{ selectedAlert.source }}</span>
                </div>
              </div>
              <div>
                <p class="text-xs text-muted mb-1">
                  Created
                </p>
                <p class="text-sm text-default">
                  {{ formatTime(selectedAlert.createdAt) }}
                </p>
              </div>
            </div>

            <div
              v-if="selectedAlert.acknowledgedAt"
              class="grid grid-cols-2 gap-3"
            >
              <div>
                <p class="text-xs text-muted mb-1">
                  Acknowledged
                </p>
                <p class="text-sm text-default">
                  {{ formatTime(selectedAlert.acknowledgedAt) }}
                </p>
              </div>
              <div v-if="selectedAlert.resolvedAt">
                <p class="text-xs text-muted mb-1">
                  Resolved
                </p>
                <p class="text-sm text-default">
                  {{ formatTime(selectedAlert.resolvedAt) }}
                </p>
              </div>
            </div>

            <div v-if="selectedAlert.metadata && Object.keys(selectedAlert.metadata).length">
              <p class="text-xs text-muted mb-1">
                Metadata
              </p>
              <pre class="text-xs bg-elevated p-2 rounded overflow-auto max-h-40">{{ JSON.stringify(selectedAlert.metadata, null, 2) }}</pre>
            </div>
          </div>

          <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
            <UButton
              class="flex-1"
              variant="ghost"
              @click="openDetail = false"
            >
              Close
            </UButton>
            <UButton
              v-if="selectedAlert.status === 'active'"
              class="flex-1"
              color="warning"
              :loading="actionLoading === `ack-${selectedAlert._id}`"
              @click="handleAcknowledge(selectedAlert); openDetail = false"
            >
              Acknowledge
            </UButton>
            <UButton
              v-if="selectedAlert.status !== 'resolved'"
              class="flex-1"
              color="success"
              :loading="actionLoading === `resolve-${selectedAlert._id}`"
              @click="handleResolve(selectedAlert); openDetail = false"
            >
              Resolve
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
