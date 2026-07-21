<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'

/**
 * Audit Logs page — view, filter, and export audit logs with compliance reporting.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const {
  getAll,
  getStats,
  exportLogs,
  generateComplianceReport,
  previewRetention,
  enforceRetention
} = useAuditLogs()

const toast = useToast()

// Pagination
const page = ref(1)
const pageSize = 50

// Filters
const selectedAction = ref<TAuditAction | 'all'>('all')
const selectedResource = ref<TAuditResource | 'all'>('all')
const selectedSuccess = ref<'all' | 'true' | 'false'>('all')
const search = ref('')

// Date range for filtering and export
const dateRange = ref<{ start: Date, end: Date }>({
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
  end: new Date()
})

const actionOptions = [
  { label: 'All Actions', value: 'all' },
  { label: 'Create', value: 'create' },
  { label: 'Read', value: 'read' },
  { label: 'Update', value: 'update' },
  { label: 'Delete', value: 'delete' },
  { label: 'Login', value: 'login' },
  { label: 'Logout', value: 'logout' },
  { label: 'Login Failed', value: 'login_failed' },
  { label: 'Deploy', value: 'deploy' },
  { label: 'Rollback', value: 'rollback' },
  { label: 'Scale', value: 'scale' },
  { label: 'Backup', value: 'backup' },
  { label: 'Restore', value: 'restore' },
  { label: 'Permission Change', value: 'permission_change' },
  { label: 'API Token Create', value: 'api_token_create' },
  { label: 'API Token Revoke', value: 'api_token_revoke' },
  { label: 'Export', value: 'export' }
]

const resourceOptions = [
  { label: 'All Resources', value: 'all' },
  { label: 'User', value: 'user' },
  { label: 'App', value: 'app' },
  { label: 'Resource', value: 'addon' },
  { label: 'Deployment', value: 'deployment' },
  { label: 'Cluster', value: 'cluster' },
  { label: 'Node', value: 'node' },
  { label: 'API Token', value: 'api_token' },
  { label: 'SSH Key', value: 'ssh_key' },
  { label: 'Secret', value: 'secret' },
  { label: 'Settings', value: 'settings' },
  { label: 'Audit Log', value: 'audit_log' }
]

const successOptions = [
  { label: 'All', value: 'all' },
  { label: 'Success', value: 'true' },
  { label: 'Failed', value: 'false' }
]

// Fetch audit logs
const { data, status, refresh } = useLazyAsyncData(
  'audit-logs',
  () => getAll({
    page: page.value,
    limit: pageSize,
    action: selectedAction.value === 'all' ? undefined : selectedAction.value,
    resource: selectedResource.value === 'all' ? undefined : selectedResource.value,
    success: selectedSuccess.value === 'all' ? undefined : selectedSuccess.value === 'true',
    startDate: dateRange.value.start.toISOString(),
    endDate: dateRange.value.end.toISOString(),
    search: search.value
  }),
  { immediate: true, server: false }
)

const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => data.value?.pages ?? 1)
const loading = computed(() => status.value === 'pending')

// Fetch stats
const { data: statsData, refresh: refreshStats } = useLazyAsyncData(
  'audit-stats',
  () => getStats({
    startDate: dateRange.value.start.toISOString(),
    endDate: dateRange.value.end.toISOString()
  }),
  { immediate: true, server: false }
)

const stats = computed(() => statsData.value)

// Reset page and refresh when filters change
watch([selectedAction, selectedResource, selectedSuccess, dateRange], () => {
  page.value = 1
  refresh()
  refreshStats()
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

onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
})

// Table columns
const columns: TableColumn<TAuditLog>[] = [
  { accessorKey: 'createdAt', header: 'Time' },
  { accessorKey: 'userEmail', header: 'User' },
  { accessorKey: 'action', header: 'Action' },
  { accessorKey: 'resource', header: 'Resource' },
  { accessorKey: 'success', header: 'Status' },
  { id: 'details' }
]

// Export modal
const openExport = ref(false)
const exportFormat = ref<TExportFormat>('csv')
const exportLoading = ref(false)

const exportFormatOptions = [
  { label: 'CSV', value: 'csv' },
  { label: 'JSON', value: 'json' }
]

async function handleExport() {
  exportLoading.value = true
  try {
    await exportLogs({
      startDate: dateRange.value.start.toISOString(),
      endDate: dateRange.value.end.toISOString(),
      format: exportFormat.value,
      filters: {
        action: selectedAction.value === 'all' ? undefined : selectedAction.value,
        resource: selectedResource.value === 'all' ? undefined : selectedResource.value,
        success: selectedSuccess.value === 'all' ? undefined : selectedSuccess.value === 'true'
      }
    })
    toast.add({ title: 'Export started', description: 'Your download should begin shortly', color: 'success' })
    openExport.value = false
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Export failed', description: error.message, color: 'error' })
  } finally {
    exportLoading.value = false
  }
}

// Compliance report modal
const openReport = ref(false)
const reportType = ref<TComplianceReportType>('general')
const reportLoading = ref(false)
const complianceReport = ref<TComplianceReport | null>(null)

const reportTypeOptions = [
  { label: 'General', value: 'general' },
  { label: 'SOC 2', value: 'soc2' },
  { label: 'GDPR', value: 'gdpr' },
  { label: 'HIPAA', value: 'hipaa' }
]

async function handleGenerateReport() {
  reportLoading.value = true
  try {
    complianceReport.value = await generateComplianceReport({
      startDate: dateRange.value.start.toISOString(),
      endDate: dateRange.value.end.toISOString(),
      type: reportType.value
    })
    toast.add({ title: 'Report generated', color: 'success' })
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Failed to generate report', description: error.message, color: 'error' })
  } finally {
    reportLoading.value = false
  }
}

// Retention modal
const openRetention = ref(false)
const retentionDays = ref(90)
const retentionPreview = ref<TRetentionPreview | null>(null)
const retentionLoading = ref(false)

async function handlePreviewRetention() {
  retentionLoading.value = true
  try {
    retentionPreview.value = await previewRetention(retentionDays.value)
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Failed to preview retention', description: error.message, color: 'error' })
  } finally {
    retentionLoading.value = false
  }
}

async function handleEnforceRetention() {
  retentionLoading.value = true
  try {
    const result = await enforceRetention(retentionDays.value)
    toast.add({ title: 'Retention policy enforced', description: result.message, color: 'success' })
    openRetention.value = false
    retentionPreview.value = null
    refresh()
    refreshStats()
  } catch (e: unknown) {
    const error = e as Error
    toast.add({ title: 'Failed to enforce retention', description: error.message, color: 'error' })
  } finally {
    retentionLoading.value = false
  }
}

// Detail modal
const selectedLog = ref<TAuditLog | null>(null)
const openDetail = ref(false)

function viewDetails(log: TAuditLog) {
  selectedLog.value = log
  openDetail.value = true
}

// Helpers
function getActionColor(action: TAuditAction): 'info' | 'success' | 'warning' | 'error' | 'neutral' {
  switch (action) {
    case 'create':
    case 'login':
      return 'success'
    case 'delete':
    case 'login_failed':
    case 'api_token_revoke':
      return 'error'
    case 'update':
    case 'permission_change':
    case 'role_change':
      return 'warning'
    case 'deploy':
    case 'backup':
    case 'export':
      return 'info'
    default:
      return 'neutral'
  }
}

function getResourceIcon(resource: TAuditResource): string {
  switch (resource) {
    case 'user': return 'i-lucide-user'
    case 'app': return 'i-lucide-box'
    case 'addon': return 'i-lucide-puzzle'
    case 'deployment': return 'i-lucide-rocket'
    case 'cluster': return 'i-lucide-layers'
    case 'node': return 'i-lucide-hard-drive'
    case 'api_token': return 'i-lucide-key'
    case 'ssh_key': return 'i-lucide-key-round'
    case 'secret': return 'i-lucide-lock'
    case 'settings': return 'i-lucide-settings'
    case 'alert': return 'i-lucide-bell'
    case 'audit_log': return 'i-lucide-scroll-text'
    default: return 'i-lucide-file'
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

function formatAction(action: TAuditAction): string {
  return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

function formatResource(resource: TAuditResource): string {
  return resource.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())
}

useHead({ title: 'Audit Logs' })
</script>

<template>
  <div class="space-y-6">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Audit Logs
        </h1>
        <p class="text-muted">
          View and export system audit logs
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <UButton
          icon="i-lucide-file-down"
          color="neutral"
          variant="outline"
          @click="openExport = true"
        >
          Export
        </UButton>
        <UButton
          icon="i-lucide-file-text"
          color="neutral"
          variant="outline"
          @click="openReport = true"
        >
          Compliance Report
        </UButton>
        <UButton
          icon="i-lucide-trash-2"
          color="neutral"
          variant="outline"
          @click="openRetention = true"
        >
          Retention
        </UButton>
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
    </div>

    <!-- Stats Cards -->
    <div
      v-if="stats"
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
    >
      <UCard>
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
            <UIcon
              name="i-lucide-scroll-text"
              class="size-5 text-primary"
            />
          </div>
          <div>
            <p class="text-2xl font-bold text-highlighted">
              {{ stats.totalLogs.toLocaleString() }}
            </p>
            <p class="text-xs text-muted">
              Total Logs
            </p>
          </div>
        </div>
      </UCard>
      <UCard>
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-success/10">
            <UIcon
              name="i-lucide-users"
              class="size-5 text-success"
            />
          </div>
          <div>
            <p class="text-2xl font-bold text-highlighted">
              {{ stats.topUsers.length }}
            </p>
            <p class="text-xs text-muted">
              Active Users
            </p>
          </div>
        </div>
      </UCard>
      <UCard>
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-error/10">
            <UIcon
              name="i-lucide-alert-circle"
              class="size-5 text-error"
            />
          </div>
          <div>
            <p class="text-2xl font-bold text-highlighted">
              {{ stats.failureRate.toFixed(1) }}%
            </p>
            <p class="text-xs text-muted">
              Failure Rate
            </p>
          </div>
        </div>
      </UCard>
      <UCard>
        <div class="flex items-center gap-3">
          <div class="flex size-10 items-center justify-center rounded-lg bg-warning/10">
            <UIcon
              name="i-lucide-activity"
              class="size-5 text-warning"
            />
          </div>
          <div>
            <p class="text-2xl font-bold text-highlighted">
              {{ Object.keys(stats.logsByAction).length }}
            </p>
            <p class="text-xs text-muted">
              Action Types
            </p>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Filters -->
    <div class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <UInput
        v-model="search"
        placeholder="Search logs..."
        icon="i-lucide-search"
        class="w-full lg:w-64"
      />
      <USelectMenu
        v-model="selectedAction"
        :items="actionOptions"
        value-key="value"
        class="w-full lg:w-40"
      />
      <USelectMenu
        v-model="selectedResource"
        :items="resourceOptions"
        value-key="value"
        class="w-full lg:w-40"
      />
      <USelectMenu
        v-model="selectedSuccess"
        :items="successOptions"
        value-key="value"
        class="w-full lg:w-32"
      />
      <div class="flex items-center gap-2">
        <UInput
          :model-value="dateRange.start.toISOString().split('T')[0]"
          type="date"
          class="w-36"
          @update:model-value="(v: string) => dateRange.start = new Date(v)"
        />
        <span class="text-muted">to</span>
        <UInput
          :model-value="dateRange.end.toISOString().split('T')[0]"
          type="date"
          class="w-36"
          @update:model-value="(v: string) => dateRange.end = new Date(v)"
        />
      </div>
    </div>

    <!-- Logs Table -->
    <UCard>
      <UTable
        :columns="columns"
        :data="items"
        :loading="loading"
        :empty-state="{ icon: 'i-lucide-scroll-text', label: 'No audit logs found' }"
      >
        <template #createdAt-cell="{ row }">
          <span
            class="text-sm"
            :title="formatTime(row.original.createdAt)"
          >
            {{ formatRelativeTime(row.original.createdAt) }}
          </span>
        </template>

        <template #userEmail-cell="{ row }">
          <span class="text-sm">
            {{ row.original.userEmail || 'System' }}
          </span>
        </template>

        <template #action-cell="{ row }">
          <UBadge
            :color="getActionColor(row.original.action)"
            variant="subtle"
            size="sm"
          >
            {{ formatAction(row.original.action) }}
          </UBadge>
        </template>

        <template #resource-cell="{ row }">
          <div class="flex items-center gap-2">
            <UIcon
              :name="getResourceIcon(row.original.resource)"
              class="size-4 text-muted"
            />
            <span class="text-sm">{{ formatResource(row.original.resource) }}</span>
            <span
              v-if="row.original.resourceName"
              class="text-xs text-muted truncate max-w-32"
            >
              ({{ row.original.resourceName }})
            </span>
          </div>
        </template>

        <template #success-cell="{ row }">
          <UBadge
            :color="row.original.success ? 'success' : 'error'"
            variant="soft"
            size="sm"
          >
            {{ row.original.success ? 'Success' : 'Failed' }}
          </UBadge>
        </template>

        <template #details-cell="{ row }">
          <UButton
            icon="i-lucide-eye"
            color="neutral"
            variant="ghost"
            size="sm"
            square
            @click="viewDetails(row.original)"
          />
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

    <!-- Detail Modal -->
    <UModal v-model:open="openDetail">
      <template #content>
        <div
          v-if="selectedLog"
          class="p-4 space-y-4"
        >
          <div class="flex items-start justify-between">
            <div>
              <h3 class="font-semibold text-highlighted">
                Audit Log Details
              </h3>
              <p class="text-sm text-muted">
                {{ formatTime(selectedLog.createdAt) }}
              </p>
            </div>
            <UBadge
              :color="selectedLog.success ? 'success' : 'error'"
              variant="soft"
            >
              {{ selectedLog.success ? 'Success' : 'Failed' }}
            </UBadge>
          </div>

          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-xs text-muted mb-1">
                User
              </p>
              <p class="text-sm text-default">
                {{ selectedLog.userEmail || 'System' }}
              </p>
            </div>
            <div>
              <p class="text-xs text-muted mb-1">
                Action
              </p>
              <UBadge
                :color="getActionColor(selectedLog.action)"
                variant="subtle"
                size="sm"
              >
                {{ formatAction(selectedLog.action) }}
              </UBadge>
            </div>
            <div>
              <p class="text-xs text-muted mb-1">
                Resource
              </p>
              <div class="flex items-center gap-2">
                <UIcon
                  :name="getResourceIcon(selectedLog.resource)"
                  class="size-4 text-muted"
                />
                <span class="text-sm">{{ formatResource(selectedLog.resource) }}</span>
              </div>
            </div>
            <div v-if="selectedLog.resourceId">
              <p class="text-xs text-muted mb-1">
                Resource ID
              </p>
              <p class="text-sm text-default font-mono">
                {{ selectedLog.resourceId }}
              </p>
            </div>
            <div v-if="selectedLog.ip">
              <p class="text-xs text-muted mb-1">
                IP Address
              </p>
              <p class="text-sm text-default font-mono">
                {{ selectedLog.ip }}
              </p>
            </div>
            <div v-if="selectedLog.duration">
              <p class="text-xs text-muted mb-1">
                Duration
              </p>
              <p class="text-sm text-default">
                {{ selectedLog.duration }}ms
              </p>
            </div>
          </div>

          <div v-if="selectedLog.errorMessage">
            <p class="text-xs text-muted mb-1">
              Error
            </p>
            <UAlert
              color="error"
              variant="soft"
              :description="selectedLog.errorMessage"
            />
          </div>

          <div v-if="selectedLog.changes && selectedLog.changes.length">
            <p class="text-xs text-muted mb-1">
              Changes
            </p>
            <div class="space-y-2">
              <div
                v-for="(change, idx) in selectedLog.changes"
                :key="idx"
                class="bg-elevated p-2 rounded text-sm"
              >
                <p class="font-medium">
                  {{ change.field }}
                </p>
                <div class="flex items-center gap-2 text-xs">
                  <span class="text-error line-through">{{ JSON.stringify(change.oldValue) }}</span>
                  <UIcon
                    name="i-lucide-arrow-right"
                    class="size-3"
                  />
                  <span class="text-success">{{ JSON.stringify(change.newValue) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="selectedLog.details && Object.keys(selectedLog.details).length">
            <p class="text-xs text-muted mb-1">
              Details
            </p>
            <pre class="text-xs bg-elevated p-2 rounded overflow-auto max-h-40">{{ JSON.stringify(selectedLog.details, null, 2) }}</pre>
          </div>

          <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
            <UButton
              class="flex-1"
              variant="ghost"
              @click="openDetail = false"
            >
              Close
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Export Modal -->
    <UModal v-model:open="openExport">
      <template #content>
        <div class="p-4 space-y-4">
          <h3 class="font-semibold text-highlighted">
            Export Audit Logs
          </h3>

          <div>
            <p class="text-xs text-muted mb-2">
              Date Range
            </p>
            <p class="text-sm">
              {{ dateRange.start.toLocaleDateString() }} - {{ dateRange.end.toLocaleDateString() }}
            </p>
          </div>

          <UFormField label="Format">
            <USelectMenu
              v-model="exportFormat"
              :items="exportFormatOptions"
              value-key="value"
              class="w-full"
            />
          </UFormField>

          <UAlert
            color="info"
            variant="soft"
            icon="i-lucide-info"
            description="The export will include all logs matching your current filters."
          />

          <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
            <UButton
              class="flex-1"
              variant="ghost"
              @click="openExport = false"
            >
              Cancel
            </UButton>
            <UButton
              class="flex-1"
              :loading="exportLoading"
              @click="handleExport"
            >
              Export
            </UButton>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Compliance Report Modal -->
    <UModal v-model:open="openReport">
      <template #content>
        <div class="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
          <h3 class="font-semibold text-highlighted">
            Compliance Report
          </h3>

          <div v-if="!complianceReport">
            <div>
              <p class="text-xs text-muted mb-2">
                Date Range
              </p>
              <p class="text-sm">
                {{ dateRange.start.toLocaleDateString() }} - {{ dateRange.end.toLocaleDateString() }}
              </p>
            </div>

            <UFormField label="Report Type">
              <USelectMenu
                v-model="reportType"
                :items="reportTypeOptions"
                value-key="value"
                class="w-full"
              />
            </UFormField>

            <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
              <UButton
                class="flex-1"
                variant="ghost"
                @click="openReport = false"
              >
                Cancel
              </UButton>
              <UButton
                class="flex-1"
                :loading="reportLoading"
                @click="handleGenerateReport"
              >
                Generate
              </UButton>
            </div>
          </div>

          <div v-else>
            <!-- Report Summary -->
            <div class="grid grid-cols-2 gap-3">
              <div class="bg-elevated p-3 rounded">
                <p class="text-2xl font-bold text-highlighted">
                  {{ complianceReport.summary.totalActions.toLocaleString() }}
                </p>
                <p class="text-xs text-muted">
                  Total Actions
                </p>
              </div>
              <div class="bg-elevated p-3 rounded">
                <p class="text-2xl font-bold text-highlighted">
                  {{ complianceReport.summary.uniqueUsers }}
                </p>
                <p class="text-xs text-muted">
                  Unique Users
                </p>
              </div>
              <div class="bg-elevated p-3 rounded">
                <p class="text-2xl font-bold text-error">
                  {{ complianceReport.summary.failedActions }}
                </p>
                <p class="text-xs text-muted">
                  Failed Actions
                </p>
              </div>
              <div class="bg-elevated p-3 rounded">
                <p class="text-2xl font-bold text-warning">
                  {{ complianceReport.summary.securityEvents }}
                </p>
                <p class="text-xs text-muted">
                  Security Events
                </p>
              </div>
            </div>

            <!-- Resource Changes -->
            <div>
              <p class="text-sm font-medium mb-2">
                Resource Changes
              </p>
              <div class="space-y-2">
                <div class="flex items-center justify-between text-sm">
                  <span>Apps</span>
                  <span>
                    <span class="text-success">+{{ complianceReport.resourceChanges.apps.created }}</span>
                    <span class="text-error mx-1">-{{ complianceReport.resourceChanges.apps.deleted }}</span>
                    <span class="text-info">{{ complianceReport.resourceChanges.apps.deployed }} deployed</span>
                  </span>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <span>Resources</span>
                  <span>
                    <span class="text-success">+{{ complianceReport.resourceChanges.resources.created }}</span>
                    <span class="text-error mx-1">-{{ complianceReport.resourceChanges.resources.deleted }}</span>
                    <span class="text-info">{{ complianceReport.resourceChanges.resources.backed_up }} backed up</span>
                  </span>
                </div>
                <div class="flex items-center justify-between text-sm">
                  <span>Users</span>
                  <span>
                    <span class="text-success">+{{ complianceReport.resourceChanges.users.created }}</span>
                    <span class="text-error mx-1">-{{ complianceReport.resourceChanges.users.deleted }}</span>
                    <span class="text-warning">{{ complianceReport.resourceChanges.users.permission_changes }} perm changes</span>
                  </span>
                </div>
              </div>
            </div>

            <!-- Security Events -->
            <div v-if="complianceReport.securityEvents.failedLogins.length">
              <p class="text-sm font-medium mb-2 text-error">
                Failed Logins ({{ complianceReport.securityEvents.failedLogins.length }})
              </p>
              <div class="max-h-32 overflow-y-auto space-y-1">
                <div
                  v-for="log in complianceReport.securityEvents.failedLogins.slice(0, 5)"
                  :key="log._id"
                  class="text-xs bg-elevated p-2 rounded"
                >
                  {{ log.details?.email || 'Unknown' }} - {{ formatTime(log.createdAt) }}
                </div>
              </div>
            </div>

            <!-- Top Users -->
            <div v-if="complianceReport.userActivity.length">
              <p class="text-sm font-medium mb-2">
                Most Active Users
              </p>
              <div class="space-y-1">
                <div
                  v-for="user in complianceReport.userActivity.slice(0, 5)"
                  :key="user.userId"
                  class="flex items-center justify-between text-sm"
                >
                  <span>{{ user.email }}</span>
                  <span class="text-muted">{{ user.actionCount }} actions</span>
                </div>
              </div>
            </div>

            <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
              <UButton
                class="flex-1"
                variant="ghost"
                @click="complianceReport = null"
              >
                Back
              </UButton>
              <UButton
                class="flex-1"
                @click="openReport = false; complianceReport = null"
              >
                Close
              </UButton>
            </div>
          </div>
        </div>
      </template>
    </UModal>

    <!-- Retention Modal -->
    <UModal v-model:open="openRetention">
      <template #content>
        <div class="p-4 space-y-4">
          <h3 class="font-semibold text-highlighted">
            Data Retention Policy
          </h3>

          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-alert-triangle"
            title="Caution"
            description="This will permanently delete old audit logs. This action cannot be undone."
          />

          <UFormField label="Delete logs older than (days)">
            <UInput
              v-model.number="retentionDays"
              type="number"
              min="1"
              max="3650"
            />
          </UFormField>

          <div v-if="retentionPreview">
            <UAlert
              :color="retentionPreview.count > 0 ? 'error' : 'success'"
              variant="soft"
              :description="retentionPreview.message"
            />
          </div>

          <div class="sticky bottom-0 border-t border-default bg-default flex gap-2 pt-3 -mx-4 -mb-4 px-4 pb-4">
            <UButton
              class="flex-1"
              variant="ghost"
              @click="openRetention = false; retentionPreview = null"
            >
              Cancel
            </UButton>
            <UButton
              v-if="!retentionPreview"
              class="flex-1"
              color="warning"
              :loading="retentionLoading"
              @click="handlePreviewRetention"
            >
              Preview
            </UButton>
            <UButton
              v-else
              class="flex-1"
              color="error"
              :loading="retentionLoading"
              :disabled="retentionPreview.count === 0"
              @click="handleEnforceRetention"
            >
              Delete {{ retentionPreview.count }} logs
            </UButton>
          </div>
        </div>
      </template>
    </UModal>
  </div>
</template>
