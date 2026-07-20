<script setup lang="ts">
/**
 * ProvisionLog — live and stored deployment/provisioning log viewer.
 *
 * Generic: works for both app deployments and database provisioning.
 *
 * Props:
 *   resourceId      — app or database _id
 *   resourceType    — 'app' | 'db'
 *   status          — current status string
 *   historicalEntry — optional historical deployment entry to display (overrides live/stored fetch)
 *
 * Modes:
 *   historicalEntry provided               → display those logs directly
 *   status === 'provisioning' / 'deploying' → SSE live stream
 *   status === 'failed'                     → load stored logs from API
 *   SSE done event received                 → show final output, emit done
 */
type THistoricalEntry = {
  _id: string
  status: string
  logs?: string
  startedAt?: string
  completedAt?: string
}

const props = defineProps<{
  resourceId: string
  resourceType: 'app' | 'db'
  status: string
  historicalEntry?: THistoricalEntry | null
}>()

const emit = defineEmits<{
  done: [status: 'success' | 'failed']
}>()

const toast = useToast()
const { getLogs: getDbLogs } = useDatabase()
const { getDeployments: getAppDeployments } = useApp()

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const lines      = ref<string[]>([])
const done       = ref(false)
const doneStatus = ref<'success' | 'failed' | null>(null)
const connected  = ref(false)
const loading    = ref(false)
const logEl      = ref<HTMLElement | null>(null)

let eventSource: EventSource | null = null

// ---------------------------------------------------------------------------
// Historical mode — when historicalEntry is provided AND it's not a running entry
// If the selected entry is 'running', we should show live SSE instead
// ---------------------------------------------------------------------------
const isHistoricalMode = computed(() => 
  !!props.historicalEntry && props.historicalEntry.status !== 'running'
)

watch(() => props.historicalEntry, (entry, oldEntry) => {
  if (entry) {
    // If the entry is currently running, connect to live SSE instead of showing historical
    if (entry.status === 'running') {
      lines.value = []
      done.value = false
      doneStatus.value = null
      if (!connected.value) {
        connect()
      }
      return
    }
    
    // Disconnect any live stream for completed entries
    disconnect()
    // Load the historical logs
    if (entry.logs) {
      lines.value = entry.logs.split('\n').filter(Boolean)
    } else {
      lines.value = []
    }
    done.value = true
    doneStatus.value = entry.status === 'success' ? 'success' : entry.status === 'failed' ? 'failed' : null
    scrollToBottom()
  } else if (oldEntry && !entry) {
    // Transitioning out of historical mode — check if we should connect to live stream
    lines.value = []
    done.value = false
    doneStatus.value = null
    if (activeStatuses.includes(props.status)) {
      connect()
    }
  }
}, { immediate: true })

// ---------------------------------------------------------------------------
// SSE URL based on resource type
// ---------------------------------------------------------------------------
const streamUrl = computed(() =>
  props.resourceType === 'app'
    ? `/api/apps/${props.resourceId}/deploy/stream`
    : `/api/databases/${props.resourceId}/provision/stream`
)

const activeStatuses = ['provisioning', 'deploying']

// ---------------------------------------------------------------------------
// SSE (live stream)
// ---------------------------------------------------------------------------
function connect() {
  if (eventSource) { eventSource.close(); eventSource = null }

  lines.value = []
  done.value = false
  doneStatus.value = null
  connected.value = false

  eventSource = new EventSource(streamUrl.value, { withCredentials: true })

  eventSource.onopen = () => { connected.value = true }

  eventSource.onmessage = (e: MessageEvent) => {
    try {
      const data = JSON.parse(e.data) as { line?: string; done?: boolean; status?: string }
      if (data.line !== undefined) {
        lines.value.push(data.line)
        scrollToBottom()
      }
      if (data.done) {
        done.value = true
        doneStatus.value = (data.status as 'success' | 'failed') ?? null
        connected.value = false
        emit('done', doneStatus.value ?? 'failed')
        eventSource?.close()
        eventSource = null
      }
    } catch { /* ignore */ }
  }

  eventSource.onerror = () => {
    connected.value = false
    eventSource?.close()
    eventSource = null
    if (!done.value) loadStoredLogs()
  }
}

function disconnect() {
  eventSource?.close()
  eventSource = null
  connected.value = false
}

// ---------------------------------------------------------------------------
// Stored logs fallback
// ---------------------------------------------------------------------------
async function loadStoredLogs() {
  loading.value = true
  try {
    let logsText: string | undefined

    if (props.resourceType === 'db') {
      const data = await getDbLogs(props.resourceId)
      logsText = data.deployments?.[0]?.logs
    } else {
      const data = await getAppDeployments(props.resourceId)
      logsText = data.deployments?.[0]?.logs
    }

    if (logsText) {
      lines.value = logsText.split('\n').filter(Boolean)
      done.value = true
      doneStatus.value = 'failed'
      scrollToBottom()
    } else {
      lines.value = ['No log output stored for this deployment.']
      done.value = true
      doneStatus.value = 'failed'
    }
  } catch {
    lines.value = ['Failed to load stored logs.']
    done.value = true
    doneStatus.value = 'failed'
  } finally {
    loading.value = false
  }
}

// ---------------------------------------------------------------------------
// Auto-scroll
// ---------------------------------------------------------------------------
function scrollToBottom() {
  nextTick(() => {
    if (logEl.value) logEl.value.scrollTop = logEl.value.scrollHeight
  })
}

// ---------------------------------------------------------------------------
// Copy logs
// ---------------------------------------------------------------------------
function copyLogs() {
  const text = lines.value.join('\n')
  if (!text) return
  navigator.clipboard.writeText(text)
  toast.add({ title: 'Logs copied to clipboard', color: 'success', icon: 'i-lucide-check' })
}

// ---------------------------------------------------------------------------
// Clear and start fresh (called by parent when initiating new provision)
// ---------------------------------------------------------------------------
function clearAndConnect() {
  lines.value = []
  done.value = false
  doneStatus.value = null
  connect()
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
onMounted(() => {
  // Don't auto-connect if in historical mode
  if (isHistoricalMode.value) return

  if (activeStatuses.includes(props.status)) {
    connect()
  } else if (props.status === 'failed') {
    loadStoredLogs()
  }
})

onUnmounted(() => { disconnect() })

watch(() => props.status, (newStatus, oldStatus) => {
  // Don't react to status changes if in historical mode
  if (isHistoricalMode.value) return

  if (activeStatuses.includes(newStatus) && !activeStatuses.includes(oldStatus)) connect()
  if (!activeStatuses.includes(newStatus) && activeStatuses.includes(oldStatus) && !done.value) disconnect()
})

// ---------------------------------------------------------------------------
// Line colouring
// ---------------------------------------------------------------------------
function lineClass(line: string): string {
  const l = line.toLowerCase()
  if (l.includes('[error]') || l.includes('error:') || l.includes('fatal') || l.includes('failed')) return 'text-red-400'
  if (l.includes('warning') || l.includes('warn')) return 'text-yellow-400'
  if (l.includes(' ok') || l.includes('changed') || l.includes('success') || l.includes('completed')) return 'text-green-400'
  if (l.startsWith('play ') || l.startsWith('task ') || l.startsWith('[provision]') || l.startsWith('[deploy]') || l.startsWith('deploying')) return 'text-blue-400 font-medium'
  if (l.startsWith('[err]') || l.startsWith('[stderr]')) return 'text-orange-400'
  return 'text-neutral-300'
}

defineExpose({ clearAndConnect })
</script>

<template>
  <div class="rounded-xl border border-default bg-[#0d1117] overflow-hidden">
    <!-- Header bar -->
    <div class="flex items-center justify-between px-4 py-2.5 bg-[#161b22] border-b border-default">
      <div class="flex items-center gap-2">
        <div
          class="size-2.5 rounded-full shrink-0"
          :class="{
            'bg-green-500 animate-pulse': connected,
            'bg-yellow-400 animate-pulse': loading,
            'bg-green-400': !connected && !loading && doneStatus === 'success',
            'bg-red-400':   !connected && !loading && doneStatus === 'failed',
            'bg-neutral-500': !connected && !loading && !doneStatus,
          }"
        />
        <span class="text-xs font-mono text-neutral-400">
          <template v-if="loading">Loading stored logs…</template>
          <template v-else-if="connected">
            Live · {{ resourceType === 'app' ? 'deployment' : 'provisioning' }} in progress
          </template>
          <template v-else-if="doneStatus === 'success'">Completed successfully</template>
          <template v-else-if="doneStatus === 'failed'">
            {{ resourceType === 'app' ? 'Deployment' : 'Provisioning' }} failed
          </template>
          <template v-else-if="activeStatuses.includes(status)">Connecting…</template>
          <template v-else>
            {{ resourceType === 'app' ? 'Deployment' : 'Provisioning' }} log
          </template>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-neutral-500 font-mono">{{ lines.length }} lines</span>
        <UButton
          v-if="lines.length"
          icon="i-lucide-copy"
          color="neutral"
          variant="ghost"
          size="xs"
          @click="copyLogs"
        />
      </div>
    </div>

    <!-- Log output -->
    <div
      ref="logEl"
      class="h-80 overflow-y-auto p-4 font-mono text-xs leading-relaxed select-text"
    >
      <p
        v-if="!lines.length && !loading && !done"
        class="text-neutral-500 italic"
      >
        {{ activeStatuses.includes(status) ? 'Waiting for output…' : 'No log output available.' }}
      </p>

      <div
        v-for="(line, i) in lines"
        :key="i"
        :class="['whitespace-pre-wrap break-all', lineClass(line)]"
      >{{ line }}</div>

      <div
        v-if="done && lines.length"
        class="mt-3 pt-3 border-t border-neutral-700"
      >
        <span
          v-if="doneStatus === 'success'"
          class="text-green-400 font-medium"
        >✓ Completed successfully.</span>
        <span
          v-else-if="doneStatus === 'failed'"
          class="text-red-400 font-medium"
        >✗ Failed — see output above for details.</span>
      </div>
    </div>
  </div>
</template>
