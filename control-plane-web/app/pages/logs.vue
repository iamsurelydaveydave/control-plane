<script setup lang="ts">
/**
 * Logs page — view logs from various sources with filtering.
 * Supports app, database, system, and operator logs.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getAppLogs, getSystemLogs, getOperatorLogs, getAllLogs } = useLogs()
const { getAll: getApps } = useApp()
const { getAll: getResources } = useAddon()

// Source selection
const selectedSource = ref<TLogSource | 'all'>('all')
const selectedSourceId = ref<string>('__all__')

const sourceOptions = [
  { label: 'All Logs', value: 'all' },
  { label: 'Apps', value: 'app' },
  { label: 'Resources', value: 'resource' },
  { label: 'System', value: 'system' },
  { label: 'Operator', value: 'operator' }
]

// Level filter
const selectedLevel = ref<TLogLevel | 'all'>('all')

const levelOptions = [
  { label: 'All Levels', value: 'all' },
  { label: 'Debug', value: 'debug' },
  { label: 'Info', value: 'info' },
  { label: 'Warn', value: 'warn' },
  { label: 'Error', value: 'error' },
  { label: 'Fatal', value: 'fatal' }
]

// Time range filter
const timeRange = ref<'1h' | '6h' | '24h' | '7d' | 'custom'>('1h')

const timeRangeOptions = [
  { label: 'Last Hour', value: '1h' },
  { label: 'Last 6 Hours', value: '6h' },
  { label: 'Last 24 Hours', value: '24h' },
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Custom', value: 'custom' }
]

// Search
const search = ref('')

// Pagination
const page = ref(1)
const pageSize = 50

// Auto-scroll
const autoScroll = ref(false)
const logsContainer = ref<HTMLElement | null>(null)

// Calculate time range dates
function getTimeRangeDates() {
  const now = new Date()
  let startTime: Date | undefined

  switch (timeRange.value) {
    case '1h':
      startTime = new Date(now.getTime() - 60 * 60 * 1000)
      break
    case '6h':
      startTime = new Date(now.getTime() - 6 * 60 * 60 * 1000)
      break
    case '24h':
      startTime = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      break
    case '7d':
      startTime = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
      break
    case 'custom':
      startTime = undefined
      break
  }

  return {
    startTime: startTime?.toISOString(),
    endTime: undefined
  }
}

// Fetch apps and resources for source selection
const { data: appsData } = useLazyAsyncData('logs-apps', () => getApps(), { immediate: true, server: false })
const { data: resourcesData } = useLazyAsyncData('logs-resources', () => getResources(), { immediate: true, server: false })

const appOptions = computed(() => [
  { label: 'All Apps', value: '__all__' },
  ...(appsData.value?.items ?? []).map((app: TApp) => ({ label: app.name, value: app._id }))
])

const resourceOptions = computed(() => [
  { label: 'All Resources', value: '__all__' },
  ...(resourcesData.value?.items ?? []).map((r: TAddon) => ({ label: r.name, value: r._id }))
])

// Determine which source selector to show
const showSourceIdSelector = computed(() =>
  selectedSource.value === 'app' || selectedSource.value === 'resource'
)

// Fetch logs based on selected source
async function fetchLogs() {
  const { startTime, endTime } = getTimeRangeDates()
  const level = selectedLevel.value === 'all' ? undefined : selectedLevel.value

  const baseOptions = {
    page: page.value,
    level,
    search: search.value,
    startTime,
    endTime
  }

  switch (selectedSource.value) {
    case 'app':
      if (selectedSourceId.value && selectedSourceId.value !== '__all__') {
        return getAppLogs(selectedSourceId.value, baseOptions)
      }
      return getAllLogs({ ...baseOptions, source: 'app' })
    case 'resource':
      // Resources don't have dedicated log endpoints yet, use all logs filtered
      return getAllLogs({ ...baseOptions, source: 'resource' })
    case 'system':
      return getSystemLogs(baseOptions)
    case 'operator':
      return getOperatorLogs(baseOptions)
    default:
      return getAllLogs(baseOptions)
  }
}

const { data, status, refresh } = useLazyAsyncData(
  'logs',
  fetchLogs,
  { immediate: true, server: false }
)

const items = computed(() => data.value?.items ?? [])
const totalPages = computed(() => data.value?.pages ?? 1)
const loading = computed(() => status.value === 'pending')

// Reset page and refresh when filters change
watch([selectedSource, selectedSourceId, selectedLevel, timeRange], () => {
  page.value = 1
  refresh()
})

// Reset sourceId when source changes
watch(selectedSource, () => {
  selectedSourceId.value = '__all__'
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

// Auto-scroll to bottom when new logs arrive
watch(items, () => {
  if (autoScroll.value && logsContainer.value) {
    nextTick(() => {
      logsContainer.value?.scrollTo({ top: logsContainer.value.scrollHeight, behavior: 'smooth' })
    })
  }
})

// Helpers
function getLevelColor(level: TLogLevel): 'neutral' | 'info' | 'warning' | 'error' {
  switch (level) {
    case 'debug': return 'neutral'
    case 'info': return 'info'
    case 'warn': return 'warning'
    case 'error':
    case 'fatal': return 'error'
  }
}

function getSourceIcon(source: TLogSource): string {
  switch (source) {
    case 'app': return 'i-lucide-box'
    case 'resource': return 'i-lucide-puzzle'
    case 'system': return 'i-lucide-monitor'
    case 'operator': return 'i-lucide-terminal'
    default: return 'i-lucide-file-text'
  }
}

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3
  })
}

function formatDate(timestamp: string): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric'
  })
}

// Cleanup
onUnmounted(() => {
  if (searchTimeout) clearTimeout(searchTimeout)
})

useHead({ title: 'Logs' })
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Logs
        </h1>
        <p class="text-muted">
          View and search application logs
        </p>
      </div>
      <div class="flex items-center gap-2">
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

    <!-- Filters -->
    <div class="flex flex-col gap-3">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
        <UInput
          v-model="search"
          placeholder="Search logs..."
          icon="i-lucide-search"
          class="w-full sm:w-64"
        />
        <USelectMenu
          v-model="selectedSource"
          :items="sourceOptions"
          value-key="value"
          class="w-full sm:w-40"
        />
        <USelectMenu
          v-if="showSourceIdSelector && selectedSource === 'app'"
          v-model="selectedSourceId"
          :items="appOptions"
          value-key="value"
          class="w-full sm:w-48"
        />
        <USelectMenu
          v-if="showSourceIdSelector && selectedSource === 'resource'"
          v-model="selectedSourceId"
          :items="resourceOptions"
          value-key="value"
          class="w-full sm:w-48"
        />
        <USelectMenu
          v-model="selectedLevel"
          :items="levelOptions"
          value-key="value"
          class="w-full sm:w-36"
        />
        <USelectMenu
          v-model="timeRange"
          :items="timeRangeOptions"
          value-key="value"
          class="w-full sm:w-40"
        />
      </div>

      <div class="flex items-center gap-3">
        <label class="flex items-center gap-2 text-sm text-muted cursor-pointer">
          <USwitch
            v-model="autoScroll"
            size="sm"
          />
          <span>Auto-scroll</span>
        </label>
        <span class="text-xs text-muted">
          {{ data?.total ?? 0 }} logs found
        </span>
      </div>
    </div>

    <!-- Logs Display -->
    <UCard :ui="{ body: 'p-0' }">
      <!-- Loading State -->
      <template v-if="loading && items.length === 0">
        <div class="divide-y divide-default">
          <div
            v-for="i in 10"
            :key="i"
            class="flex gap-3 p-3"
          >
            <div class="w-20 h-4 bg-muted rounded animate-pulse" />
            <div class="w-16 h-4 bg-muted rounded animate-pulse" />
            <div class="flex-1 h-4 bg-muted rounded animate-pulse" />
          </div>
        </div>
      </template>

      <!-- Empty State -->
      <template v-else-if="!loading && items.length === 0">
        <div class="flex flex-col items-center justify-center py-12 text-center">
          <UIcon
            name="i-lucide-file-text"
            class="size-12 text-muted mb-3"
          />
          <p class="text-muted">
            No logs found for the selected filters
          </p>
          <UButton
            class="mt-3"
            variant="outline"
            @click="selectedSource = 'all'; selectedLevel = 'all'; search = ''"
          >
            Clear filters
          </UButton>
        </div>
      </template>

      <!-- Logs List -->
      <template v-else>
        <div
          ref="logsContainer"
          class="divide-y divide-default max-h-150 overflow-y-auto font-mono text-xs"
        >
          <div
            v-for="log in items"
            :key="log._id"
            class="flex gap-3 p-2 hover:bg-elevated transition-colors group"
          >
            <!-- Timestamp -->
            <div class="shrink-0 w-20 text-muted">
              <span
                :title="formatDate(log.timestamp) + ' ' + formatTimestamp(log.timestamp)"
              >
                {{ formatTimestamp(log.timestamp) }}
              </span>
            </div>

            <!-- Level Badge -->
            <div class="shrink-0 w-16">
              <UBadge
                :color="getLevelColor(log.level)"
                variant="subtle"
                size="xs"
                class="uppercase font-medium"
              >
                {{ log.level }}
              </UBadge>
            </div>

            <!-- Source -->
            <div class="shrink-0 w-24 flex items-center gap-1 text-muted">
              <UIcon
                :name="getSourceIcon(log.source)"
                class="size-3"
              />
              <span
                class="truncate"
                :title="log.sourceName || log.source"
              >
                {{ log.sourceName || log.source }}
              </span>
            </div>

            <!-- Message -->
            <div
              class="flex-1 break-all"
              :class="{
                'text-error': log.level === 'error' || log.level === 'fatal',
                'text-warning': log.level === 'warn',
                'text-muted': log.level === 'debug',
                'text-default': log.level === 'info'
              }"
            >
              {{ log.message }}
            </div>

            <!-- Metadata indicator -->
            <div
              v-if="log.metadata && Object.keys(log.metadata).length"
              class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <UTooltip :text="JSON.stringify(log.metadata, null, 2)">
                <UIcon
                  name="i-lucide-braces"
                  class="size-4 text-muted"
                />
              </UTooltip>
            </div>
          </div>
        </div>
      </template>

      <!-- Pagination -->
      <div
        v-if="totalPages > 1"
        class="flex items-center justify-between border-t border-default p-3"
      >
        <span class="text-xs text-muted">
          Page {{ page }} of {{ totalPages }}
        </span>
        <UPagination
          v-model:page="page"
          :total="totalPages * pageSize"
          :page-size="pageSize"
        />
      </div>
    </UCard>
  </div>
</template>
