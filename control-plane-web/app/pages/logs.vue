<script setup lang="ts">
/**
 * Logs page — view K8s pod logs from system, operator, or app sources.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const { getAppLogs, getSystemLogs, getOperatorLogs, searchLogs } = useLogs()
const { getAll: getApps } = useApp()

// Source selection
type LogView = 'system' | 'operator' | 'app' | 'search'
const selectedView = ref<LogView>('system')

const viewOptions = [
  { label: 'System', value: 'system' },
  { label: 'Operator', value: 'operator' },
  { label: 'App', value: 'app' },
  { label: 'Search', value: 'search' }
]

// Tail lines
const tailLines = ref(200)
const tailLinesOptions = [
  { label: '100 lines', value: 100 },
  { label: '200 lines', value: 200 },
  { label: '500 lines', value: 500 },
  { label: '1000 lines', value: 1000 }
]

// App selection
const selectedAppId = ref('')
const { data: appsData } = useLazyAsyncData('logs-apps', () => getApps(), { immediate: true, server: false })
const appOptions = computed(() =>
  (appsData.value?.items ?? []).map((app: TApp) => ({ label: app.name, value: app._id }))
)

// Pod selection (for app/operator responses with multiple pods)
const selectedPod = ref('')

// Search
const searchQuery = ref('')

// Auto-scroll
const autoScroll = ref(true)
const logsContainer = ref<HTMLElement | null>(null)

// --- Data fetching ---

// System logs
const { data: systemData, status: systemStatus, refresh: refreshSystem } = useLazyAsyncData(
  'logs-system',
  () => getSystemLogs({ tailLines: tailLines.value }),
  { immediate: false, server: false }
)

// Operator logs
const { data: operatorData, status: operatorStatus, refresh: refreshOperator } = useLazyAsyncData(
  'logs-operator',
  () => getOperatorLogs({ tailLines: tailLines.value }),
  { immediate: false, server: false }
)

// App logs
const { data: appData, status: appStatus, refresh: refreshApp } = useLazyAsyncData(
  'logs-app',
  () => {
    if (!selectedAppId.value) return Promise.resolve(null)
    return getAppLogs(selectedAppId.value, { tailLines: tailLines.value })
  },
  { immediate: false, server: false }
)

// Search logs
const { data: searchData, status: searchStatus, refresh: refreshSearch } = useLazyAsyncData(
  'logs-search',
  () => {
    if (!searchQuery.value.trim()) return Promise.resolve(null)
    return searchLogs(searchQuery.value, [], tailLines.value)
  },
  { immediate: false, server: false }
)

// Trigger fetch on view change
watch(selectedView, (view) => {
  selectedPod.value = ''
  if (view === 'system') refreshSystem()
  else if (view === 'operator') refreshOperator()
  else if (view === 'app' && selectedAppId.value) refreshApp()
}, { immediate: true })

// Trigger fetch when app changes
watch(selectedAppId, (id) => {
  selectedPod.value = ''
  if (id) refreshApp()
})

// Trigger fetch when tail lines changes
watch(tailLines, () => {
  refresh()
})

// Computed loading state
const loading = computed(() => {
  switch (selectedView.value) {
    case 'system': return systemStatus.value === 'pending'
    case 'operator': return operatorStatus.value === 'pending'
    case 'app': return appStatus.value === 'pending'
    case 'search': return searchStatus.value === 'pending'
    default: return false
  }
})

// Computed log text for current view
const currentLogs = computed<string>(() => {
  switch (selectedView.value) {
    case 'system':
      return systemData.value?.logs ?? ''
    case 'operator': {
      const pods = operatorData.value?.pods ?? []
      if (selectedPod.value) {
        return pods.find(p => p.podName === selectedPod.value)?.logs ?? ''
      }
      return pods.map(p => p.logs).join('\n') || ''
    }
    case 'app': {
      const pods = appData.value?.pods ?? []
      if (selectedPod.value) {
        return pods.find(p => p.podName === selectedPod.value)?.logs ?? ''
      }
      return pods.map(p => p.logs).join('\n') || ''
    }
    default:
      return ''
  }
})

// Pod options for operator/app views
const podOptions = computed(() => {
  let pods: TLogPod[] = []
  if (selectedView.value === 'operator') {
    pods = operatorData.value?.pods ?? []
  } else if (selectedView.value === 'app') {
    pods = appData.value?.pods ?? []
  }
  if (pods.length <= 1) return []
  return [
    { label: 'All Pods', value: '' },
    ...pods.map(p => ({ label: p.podName, value: p.podName }))
  ]
})

// Refresh current view
function refresh() {
  switch (selectedView.value) {
    case 'system': return refreshSystem()
    case 'operator': return refreshOperator()
    case 'app': return refreshApp()
    case 'search': return refreshSearch()
  }
}

// Debounced search submit
let searchTimeout: ReturnType<typeof setTimeout> | null = null
function handleSearchInput() {
  if (searchTimeout) clearTimeout(searchTimeout)
  searchTimeout = setTimeout(() => {
    refreshSearch()
  }, 400)
}

// Auto-scroll to bottom when logs update
watch(currentLogs, () => {
  if (autoScroll.value && logsContainer.value) {
    nextTick(() => {
      logsContainer.value?.scrollTo({ top: logsContainer.value.scrollHeight, behavior: 'smooth' })
    })
  }
})

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
          View pod logs from system, operator, and app sources
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
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <USelectMenu
        v-model="selectedView"
        :items="viewOptions"
        value-key="value"
        class="w-full sm:w-40"
      />

      <!-- App selector (only for app view) -->
      <USelectMenu
        v-if="selectedView === 'app'"
        v-model="selectedAppId"
        :items="appOptions"
        value-key="value"
        placeholder="Select app..."
        class="w-full sm:w-48"
      />

      <!-- Pod selector (when multiple pods) -->
      <USelectMenu
        v-if="podOptions.length > 0"
        v-model="selectedPod"
        :items="podOptions"
        value-key="value"
        class="w-full sm:w-56"
      />

      <!-- Search input (only for search view) -->
      <UInput
        v-if="selectedView === 'search'"
        v-model="searchQuery"
        placeholder="Search logs..."
        icon="i-lucide-search"
        class="w-full sm:w-64"
        @input="handleSearchInput"
        @keydown.enter="refreshSearch()"
      />

      <!-- Tail lines selector -->
      <USelectMenu
        v-model="tailLines"
        :items="tailLinesOptions"
        value-key="value"
        class="w-full sm:w-36"
      />

      <!-- Auto-scroll toggle -->
      <label class="flex items-center gap-2 text-sm text-muted cursor-pointer shrink-0">
        <USwitch v-model="autoScroll" size="sm" />
        <span>Auto-scroll</span>
      </label>
    </div>

    <!-- Search Results View -->
    <template v-if="selectedView === 'search'">
      <UCard :ui="{ body: 'p-0' }">
        <template v-if="loading">
          <div class="p-6 space-y-3">
            <div v-for="i in 5" :key="i" class="h-4 bg-muted rounded animate-pulse" />
          </div>
        </template>

        <template v-else-if="!searchData?.results?.length">
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <UIcon name="i-lucide-search" class="size-12 text-muted mb-3" />
            <p class="text-muted">
              {{ searchQuery.trim() ? 'No results found' : 'Enter a search query to search across log sources' }}
            </p>
          </div>
        </template>

        <template v-else>
          <div class="divide-y divide-default">
            <div
              v-for="(result, idx) in searchData.results"
              :key="idx"
              class="p-4"
            >
              <div class="flex items-center gap-2 mb-2">
                <UIcon name="i-lucide-terminal" class="size-4 text-muted" />
                <span class="text-sm font-medium text-highlighted">{{ result.sourceName }}</span>
                <UBadge variant="subtle" color="neutral" size="xs">
                  {{ result.source }}
                </UBadge>
              </div>
              <pre
                class="text-xs font-mono whitespace-pre-wrap break-all text-default bg-elevated rounded p-3 max-h-80 overflow-y-auto"
              >{{ result.logs }}</pre>
            </div>
          </div>
        </template>
      </UCard>
    </template>

    <!-- Log Output View (system / operator / app) -->
    <template v-else>
      <UCard :ui="{ body: 'p-0' }">
        <!-- Loading -->
        <template v-if="loading && !currentLogs">
          <div class="p-6 space-y-2">
            <div v-for="i in 12" :key="i" class="h-3.5 bg-muted rounded animate-pulse" :style="{ width: `${50 + Math.random() * 50}%` }" />
          </div>
        </template>

        <!-- Empty state -->
        <template v-else-if="!currentLogs">
          <div class="flex flex-col items-center justify-center py-12 text-center">
            <UIcon name="i-lucide-file-text" class="size-12 text-muted mb-3" />
            <p class="text-muted">
              <template v-if="selectedView === 'app' && !selectedAppId">
                Select an app to view its logs
              </template>
              <template v-else>
                No logs available
              </template>
            </p>
          </div>
        </template>

        <!-- Log output -->
        <template v-else>
          <!-- Source info bar -->
          <div class="flex items-center gap-2 px-4 py-2 border-b border-default text-xs text-muted">
            <UIcon name="i-lucide-terminal" class="size-3.5" />
            <template v-if="selectedView === 'system'">
              <span>{{ systemData?.sourceName ?? 'System' }}</span>
            </template>
            <template v-else-if="selectedView === 'operator'">
              <span>Operator</span>
              <span v-if="operatorData?.pods?.length">({{ operatorData.pods.length }} pod{{ operatorData.pods.length > 1 ? 's' : '' }})</span>
            </template>
            <template v-else-if="selectedView === 'app'">
              <span>{{ appData?.appName ?? 'App' }}</span>
              <span v-if="appData?.pods?.length">({{ appData.pods.length }} pod{{ appData.pods.length > 1 ? 's' : '' }})</span>
            </template>
          </div>

          <div
            ref="logsContainer"
            class="max-h-[600px] overflow-y-auto"
          >
            <pre class="text-xs font-mono whitespace-pre-wrap break-all p-4 text-default leading-relaxed">{{ currentLogs }}</pre>
          </div>
        </template>
      </UCard>
    </template>
  </div>
</template>
