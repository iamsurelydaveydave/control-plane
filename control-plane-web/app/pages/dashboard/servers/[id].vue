<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const route = useRoute()
const id = route.params.id as string
const toast = useToast()
const { getById, deleteById, checkHealth, setupServer, updateById, getServerApps, getServerDatabases } = useServer()
const { getAll: getAllSSHKeys } = useSSHKey()

// ── Server data ──────────────────────────────────────────────────────────────

const { data: serverData, refresh, status } = useLazyAsyncData(
  `server-${id}`,
  () => getById(id),
  { server: false }
)
const server = computed(() => serverData.value?.server)
const loading = computed(() => status.value === 'idle' || status.value === 'pending')

const { data: sshKeysData } = useLazyAsyncData(
  'ssh-keys',
  () => getAllSSHKeys().catch(() => ({ items: [] })),
  { server: false }
)
const sshKeyOptions = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return [
    { value: '__none__', label: 'None' },
    ...keys.map(k => ({ value: k._id, label: k.name + (k.isDefault ? ' (default)' : '') }))
  ]
})
const activeSSHKey = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.find(k => k._id === server.value?.sshKeyId) ?? null
})

// ── Apps & databases on this server ────────────────────────────────────────

const { data: appsData, status: appsStatus } = useLazyAsyncData(
  `server-apps-${id}`,
  () => getServerApps(id),
  { server: false }
)
const serverApps = computed(() => appsData.value?.items ?? [])
const appsLoading = computed(() => appsStatus.value === 'idle' || appsStatus.value === 'pending')

const { data: dbsData, status: dbsStatus } = useLazyAsyncData(
  `server-dbs-${id}`,
  () => getServerDatabases(id),
  { server: false }
)
const serverDatabases = computed(() => dbsData.value?.items ?? [])
const dbsLoading = computed(() => dbsStatus.value === 'idle' || dbsStatus.value === 'pending')

// ── SSE: real-time setup progress ────────────────────────────────────────────

let eventSource: EventSource | null = null

function connectSSE() {
  if (eventSource) return
  eventSource = new EventSource(`/api/servers/${id}/setup-stream`)

  eventSource.addEventListener('update', (e: MessageEvent) => {
    const update = JSON.parse(e.data)
    if (serverData.value?.server) {
      Object.assign(serverData.value.server, update)
    }
  })

  eventSource.addEventListener('done', () => {
    eventSource?.close()
    eventSource = null
    refresh()
  })

  eventSource.onerror = () => {
    eventSource?.close()
    eventSource = null
  }
}

function disconnectSSE() {
  eventSource?.close()
  eventSource = null
}

watch(
  () => server.value?.setupStatus,
  (setupStatus) => {
    if (setupStatus === 'running') connectSSE()
    else disconnectSSE()
  },
  { immediate: true }
)

onUnmounted(() => disconnectSSE())

// ── Edit connection details ───────────────────────────────────────────────────

const editing = ref(false)
const saving = ref(false)
const editForm = reactive({
  name: '',
  host: '',
  sshUser: '',
  sshPort: 22,
  sshKeyId: '__none__' as string,
  sshConnectTimeout: 30,
  timezone: ''
})

function startEdit() {
  if (!server.value) return
  Object.assign(editForm, {
    name: server.value.name,
    host: server.value.host,
    sshUser: server.value.sshUser,
    sshPort: server.value.sshPort,
    sshKeyId: server.value.sshKeyId ?? '__none__',
    sshConnectTimeout: server.value.sshConnectTimeout ?? 30,
    timezone: server.value.timezone ?? ''
  })
  editing.value = true
}

function cancelEdit() {
  editing.value = false
}

async function saveEdit() {
  if (saving.value) return
  saving.value = true
  try {
    await updateById(id, {
      name: editForm.name,
      host: editForm.host,
      sshUser: editForm.sshUser,
      sshPort: editForm.sshPort,
      sshKeyId: editForm.sshKeyId === '__none__' ? undefined : editForm.sshKeyId,
      sshConnectTimeout: editForm.sshConnectTimeout,
      timezone: editForm.timezone || undefined
    })
    editing.value = false
    await refresh()
    toast.add({ title: 'Server updated', color: 'success', icon: 'i-lucide-check' })
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to update server', color: 'error' })
  } finally {
    saving.value = false
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

const checkingHealth = ref(false)
async function handleCheckHealth() {
  if (checkingHealth.value) return
  checkingHealth.value = true
  try {
    const result = await checkHealth(id)
    // Patch health check history directly without a full page refresh
    if (serverData.value?.server) {
      serverData.value.server.healthChecks = result.healthChecks
      serverData.value.server.lastHealthCheck = result.healthChecks[0]?.timestamp
      if (result.success && result.resources) {
        serverData.value.server.resources = result.resources
        serverData.value.server.status = 'online'
      } else if (!result.success) {
        serverData.value.server.status = 'offline'
      }
    }
    if (result.success) {
      const uptime = result.serverInfo?.uptime
      const res = result.resources
      const desc = [
        uptime ? `Uptime: ${uptime}` : null,
        res ? `${res.cpuCores} vCPU · ${Math.round((res.memoryMb ?? 0) / 1024)} GB RAM · ${res.diskGb} GB disk` : null,
      ].filter(Boolean).join(' · ')
      toast.add({ title: 'Server is online', description: desc || undefined, color: 'success', icon: 'i-lucide-check' })
    } else {
      toast.add({ title: 'Server is unreachable', description: result.error, color: 'error', icon: 'i-lucide-wifi-off' })
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Health check failed', color: 'error' })
  } finally {
    checkingHealth.value = false
  }
}

const settingUp = ref(false)
async function handleSetup() {
  if (settingUp.value) return
  settingUp.value = true
  try {
    await setupServer(id)
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to start setup', color: 'error' })
  } finally {
    settingUp.value = false
  }
}

const deleteOpen = ref(false)
const deleteConfirmName = ref('')
const deleteConfirmMatch = computed(() => deleteConfirmName.value === server.value?.name)
const deleting = ref(false)

watch(deleteOpen, (open) => {
  if (!open) deleteConfirmName.value = ''
})

async function submitDelete() {
  if (deleting.value) return
  deleting.value = true
  try {
    await deleteById(id)
    toast.add({ title: `${server.value?.name} deleted`, color: 'success', icon: 'i-lucide-check' })
    await navigateTo('/dashboard/servers')
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to delete server', color: 'error' })
    deleting.value = false
  }
}

const canSetup = computed(() =>
  server.value?.status !== 'online' &&
  server.value?.status !== 'provisioning' &&
  server.value?.setupStatus !== 'running'
)

const actionsOpen = ref(false)

const actionItems = computed(() => {
  const close = () => { actionsOpen.value = false }

  type Item = { label: string; icon: string; color?: 'error'; onSelect: () => void }
  const groups: Item[][] = []

  const serverActions: Item[] = []
  if (canSetup.value) {
    serverActions.push({
      label: server.value?.setupStatus === 'failed' ? 'Retry Setup' : 'Setup Server',
      icon: server.value?.setupStatus === 'failed' ? 'i-lucide-refresh-cw' : 'i-lucide-play',
      onSelect: () => { close(); handleSetup() }
    })
  }
  if (server.value?.status === 'online') {
    serverActions.push({ label: 'Check Health', icon: 'i-lucide-activity', onSelect: () => { close(); handleCheckHealth() } })
  }
  if (serverActions.length) groups.push(serverActions)

  groups.push([{ label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => { close(); startEdit() } }])
  groups.push([{ label: 'Delete Server', icon: 'i-lucide-trash', color: 'error', onSelect: () => { close(); deleteOpen.value = true } }])

  return groups
})

// ── Helpers ───────────────────────────────────────────────────────────────────

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  online: 'success',
  offline: 'error',
  provisioning: 'warning',
  unknown: 'neutral'
}

function stepIcon(s: TSetupStepStatus) {
  switch (s) {
    case 'success': return 'i-lucide-check-circle-2'
    case 'failed': return 'i-lucide-x-circle'
    case 'running': return 'i-lucide-loader'
    case 'skipped': return 'i-lucide-minus-circle'
    default: return 'i-lucide-circle'
  }
}

function stepIconColor(s: TSetupStepStatus) {
  switch (s) {
    case 'success': return 'text-success'
    case 'failed': return 'text-error'
    case 'running': return 'text-primary animate-spin'
    case 'skipped': return 'text-muted'
    default: return 'text-muted'
  }
}

function formatDuration(ms?: number) {
  if (!ms) return ''
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`
}

function maskHost(host: string): string {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split('.')
    return `${a}.${b}.*.*`
  }
  const dot = host.indexOf('.')
  if (dot !== -1) return `***${host.slice(dot)}`
  return host.slice(0, 3) + '***'
}

const hostCopied = ref(false)
async function copyHost() {
  if (!server.value?.host) return
  await navigator.clipboard.writeText(server.value.host)
  hostCopied.value = true
  setTimeout(() => { hostCopied.value = false }, 2000)
}

const appStatusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  running: 'success', failed: 'error', deploying: 'warning', stopped: 'neutral', pending: 'neutral'
}
const dbStatusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  running: 'success', failed: 'error', provisioning: 'warning', stopped: 'neutral'
}

useHead({ title: computed(() => `${server.value?.name ?? 'Server'} · Control Plane`) })
</script>

<template>
  <div class="space-y-6">
    <!-- Back + header -->
    <div class="flex items-start gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/dashboard/servers"
        class="mt-1 shrink-0"
      />
      <div class="flex-1 min-w-0">
        <USkeleton
          v-if="loading"
          class="h-7 w-48 mb-1"
        />
        <div
          v-else
          class="flex items-center gap-2 flex-wrap"
        >
          <h1 class="text-2xl font-bold text-highlighted">
            {{ server?.name }}
          </h1>
          <UBadge
            :color="statusColor[server?.status ?? 'unknown']"
            variant="soft"
          >
            {{ server?.status === 'provisioning' ? 'setting up…' : server?.status }}
          </UBadge>
        </div>
        <div
          v-if="!loading"
          class="flex items-center gap-1.5 mt-0.5"
        >
          <span class="text-sm text-muted font-mono">{{ maskHost(server?.host ?? '') }}</span>
          <button
            class="text-muted hover:text-highlighted transition-colors p-0.5 rounded"
            :title="hostCopied ? 'Copied!' : 'Copy IP'"
            @click="copyHost"
          >
            <UIcon
              :name="hostCopied ? 'i-lucide-check' : 'i-lucide-copy'"
              :class="['size-3.5', hostCopied ? 'text-success' : '']"
            />
          </button>
        </div>
      </div>

      <!-- Actions dropdown -->
      <UDropdownMenu
        v-if="!loading && server"
        v-model:open="actionsOpen"
        :items="actionItems"
      >
        <UButton
          color="neutral"
          variant="soft"
          trailing-icon="i-lucide-chevron-down"
          :loading="settingUp || checkingHealth"
        >
          Actions
        </UButton>
      </UDropdownMenu>
    </div>

    <!-- Connection details skeleton -->
    <div
      v-if="loading"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="px-4 py-3">
        <USkeleton class="h-5 w-44" />
      </div>
      <div class="px-4 py-4">
        <div class="grid grid-cols-2 gap-x-8 gap-y-5">
          <div
            v-for="i in 8"
            :key="i"
            class="space-y-1.5"
          >
            <USkeleton class="h-3 w-24" />
            <USkeleton class="h-5 w-36" />
          </div>
        </div>
      </div>
    </div>

    <!-- Connection details (view / edit) -->
    <div
      v-else-if="server"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <h2 class="font-medium text-highlighted">Connection Details</h2>
      </div>

      <!-- ── View mode ── -->
      <template v-if="!editing">
        <div class="px-4 py-4">
          <dl class="grid grid-cols-2 gap-x-8 gap-y-4 text-sm">
            <div>
              <dt class="text-xs text-muted mb-0.5">Name</dt>
              <dd class="font-medium text-highlighted">{{ server.name }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">Host</dt>
              <dd class="flex items-center gap-1.5">
                <span class="font-mono">{{ maskHost(server.host) }}</span>
                <button
                  class="text-muted hover:text-highlighted transition-colors p-0.5 rounded"
                  :title="hostCopied ? 'Copied!' : 'Copy IP'"
                  @click="copyHost"
                >
                  <UIcon
                    :name="hostCopied ? 'i-lucide-check' : 'i-lucide-copy'"
                    :class="['size-3.5', hostCopied ? 'text-success' : '']"
                  />
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">SSH User</dt>
              <dd class="font-mono">{{ server.sshUser }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">SSH Port</dt>
              <dd class="font-mono">{{ server.sshPort }}</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">Timezone</dt>
              <dd
                v-if="server.timezone"
                class="font-mono"
              >{{ server.timezone }}</dd>
              <dd
                v-else
                class="text-muted italic"
              >Not configured</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-1">SSH Key</dt>
              <dd v-if="activeSSHKey">
                <div class="flex items-center gap-2 flex-wrap">
                  <UIcon
                    name="i-lucide-key"
                    class="size-4 text-muted"
                  />
                  <span class="font-medium">{{ activeSSHKey.name }}</span>
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="xs"
                  >{{ activeSSHKey.type }}</UBadge>
                  <span class="text-xs text-muted font-mono truncate max-w-xs">{{ activeSSHKey.fingerprint }}</span>
                </div>
              </dd>
              <dd
                v-else
                class="text-muted italic"
              >No key configured</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">Connection Timeout</dt>
              <dd class="font-mono">{{ server.sshConnectTimeout ?? 30 }} seconds</dd>
            </div>
            <div>
              <dt class="text-xs text-muted mb-0.5">Docker</dt>
              <dd
                v-if="server.dockerInstalled"
                class="flex items-center gap-1 text-success"
              >
                <UIcon
                  name="i-lucide-check"
                  class="size-3.5"
                />
                Installed
              </dd>
              <dd
                v-else
                class="text-muted"
              >Not installed</dd>
            </div>
            <div v-if="server.provider">
              <dt class="text-xs text-muted mb-0.5">Provider</dt>
              <dd class="capitalize">{{ server.provider }}</dd>
            </div>
          </dl>
        </div>
      </template>

      <!-- ── Edit mode ── -->
      <template v-else>
        <div class="px-4 py-4">
          <div class="grid grid-cols-2 gap-x-8 gap-y-4">
            <UFormField label="Name">
              <UInput
                v-model="editForm.name"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Host (IP or hostname)">
              <UInput
                v-model="editForm.host"
                class="w-full"
              />
            </UFormField>
            <UFormField label="SSH User">
              <UInput
                v-model="editForm.sshUser"
                class="w-full"
              />
            </UFormField>
            <UFormField label="SSH Port">
              <UInput
                v-model.number="editForm.sshPort"
                type="number"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Timezone">
              <UInput
                v-model="editForm.timezone"
                placeholder="UTC"
                class="w-full"
              />
            </UFormField>
            <UFormField label="SSH Key">
              <USelect
                v-model="editForm.sshKeyId"
                :items="sshKeyOptions"
                class="w-full"
              />
            </UFormField>
            <UFormField
              label="Connection Timeout"
              hint="seconds"
            >
              <UInput
                v-model.number="editForm.sshConnectTimeout"
                type="number"
                class="w-full"
              />
            </UFormField>
          </div>
        </div>
        <div class="flex justify-end gap-2 px-4 py-3">
          <UButton
            color="neutral"
            variant="ghost"
            :disabled="saving"
            @click="cancelEdit"
          >
            Cancel
          </UButton>
          <UButton
            :loading="saving"
            icon="i-lucide-check"
            @click="saveEdit"
          >
            Save Changes
          </UButton>
        </div>
      </template>
    </div>

    <!-- Resource metrics skeleton -->
    <div
      v-if="loading"
      class="grid grid-cols-3 gap-3"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-24 rounded-xl"
      />
    </div>

    <!-- Resource metrics -->
    <div
      v-else-if="server?.resources"
      class="grid grid-cols-3 gap-3"
    >
      <div class="rounded-xl border border-default bg-elevated/50 p-4">
        <p class="text-xs text-muted mb-1">CPU</p>
        <p class="text-2xl font-bold text-highlighted">{{ server.resources.cpuCores }}</p>
        <p class="text-xs text-muted">cores</p>
      </div>
      <div class="rounded-xl border border-default bg-elevated/50 p-4">
        <p class="text-xs text-muted mb-1">Memory</p>
        <p class="text-2xl font-bold text-highlighted">{{ Math.round((server.resources.memoryMb ?? 0) / 1024) }}</p>
        <p class="text-xs text-muted">GB RAM</p>
      </div>
      <div class="rounded-xl border border-default bg-elevated/50 p-4">
        <p class="text-xs text-muted mb-1">Disk</p>
        <p class="text-2xl font-bold text-highlighted">{{ server.resources.diskGb }}</p>
        <p class="text-xs text-muted">GB</p>
      </div>
    </div>

    <!-- Setup progress skeleton -->
    <div
      v-if="loading"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <USkeleton class="h-5 w-36" />
        <USkeleton class="h-5 w-20" />
      </div>
      <div class="px-4 py-4 space-y-3">
        <div
          v-for="i in 4"
          :key="i"
          class="flex items-center gap-3"
        >
          <USkeleton class="size-4 rounded-full shrink-0" />
          <USkeleton class="h-4 rounded w-48" />
        </div>
      </div>
    </div>

    <!-- Setup progress -->
    <div
      v-else-if="server?.setupLog?.length"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <h2 class="font-medium text-highlighted">Setup Progress</h2>
        <div class="flex items-center gap-2">
          <UBadge
            v-if="server.setupStatus === 'success'"
            color="success"
            variant="soft"
            size="xs"
          >Complete</UBadge>
          <UBadge
            v-else-if="server.setupStatus === 'failed'"
            color="error"
            variant="soft"
            size="xs"
          >Failed</UBadge>
          <UBadge
            v-else-if="server.setupStatus === 'running'"
            color="warning"
            variant="soft"
            size="xs"
          >Running</UBadge>
          <span
            v-if="server.setupCompletedAt"
            class="text-xs text-muted"
          >{{ new Date(server.setupCompletedAt).toLocaleString() }}</span>
        </div>
      </div>
      <div class="px-4 py-3 space-y-3">
        <div
          v-for="step in server.setupLog"
          :key="step.name"
          class="flex items-start gap-3 text-sm"
        >
          <UIcon
            :name="stepIcon(step.status)"
            :class="['size-4 mt-0.5 shrink-0', stepIconColor(step.status)]"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2">
              <span :class="step.status === 'failed' ? 'text-error font-medium' : 'text-highlighted'">{{ step.label }}</span>
              <span
                v-if="step.duration"
                class="text-xs text-muted"
              >{{ formatDuration(step.duration) }}</span>
            </div>
            <p
              v-if="step.output"
              class="text-xs text-muted font-mono mt-0.5 truncate"
            >{{ step.output }}</p>
            <p
              v-if="step.error"
              class="text-xs text-error font-mono mt-0.5"
            >{{ step.error }}</p>
          </div>
        </div>
        <div
          v-if="server.setupStatus === 'running'"
          class="flex items-center gap-2 text-xs text-muted pt-1 border-t border-default"
        >
          <UIcon
            name="i-lucide-loader"
            class="size-3 animate-spin"
          />
          Running setup — this may take a few minutes
        </div>
      </div>
    </div>

    <!-- No setup run yet -->
    <div
      v-else-if="!loading && server && !server.setupLog?.length"
      class="rounded-xl border border-default bg-elevated/50 p-6 text-center"
    >
      <UIcon
        name="i-lucide-terminal"
        class="mx-auto mb-3 size-8 text-muted"
      />
      <p class="text-sm text-muted">Setup has not been run on this server yet.</p>
    </div>

    <!-- Health Checks -->
    <div
      v-if="loading"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <USkeleton class="h-5 w-36" />
        <USkeleton class="h-8 w-28 rounded-lg" />
      </div>
      <div class="px-4 py-4 space-y-3">
        <div
          v-for="i in 3"
          :key="i"
          class="flex items-center gap-3"
        >
          <USkeleton class="size-2 rounded-full shrink-0" />
          <USkeleton class="h-4 rounded w-64" />
        </div>
      </div>
    </div>

    <div
      v-else-if="server"
      class="rounded-xl border border-default bg-elevated/50 divide-y divide-default"
    >
      <div class="flex items-center justify-between px-4 py-3">
        <div>
          <h2 class="font-medium text-highlighted">
            Health Checks
          </h2>
          <p
            v-if="server.lastHealthCheck"
            class="text-xs text-muted mt-0.5"
          >
            Last checked {{ new Date(server.lastHealthCheck).toLocaleString() }}
          </p>
        </div>
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-activity"
          :loading="checkingHealth"
          @click="handleCheckHealth"
        >
          Check Now
        </UButton>
      </div>

      <!-- History -->
      <div
        v-if="server.healthChecks?.length"
        class="divide-y divide-default"
      >
        <div
          v-for="(check, i) in server.healthChecks"
          :key="i"
          class="flex items-start gap-3 px-4 py-3"
        >
          <div
            :class="['mt-1.5 size-2 rounded-full shrink-0', check.status === 'online' ? 'bg-success' : 'bg-error']"
          />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span
                class="text-sm font-medium"
                :class="check.status === 'online' ? 'text-success' : 'text-error'"
              >
                {{ check.status }}
              </span>
              <span class="text-xs text-muted">
                {{ new Date(check.timestamp).toLocaleString() }}
              </span>
              <span
                v-if="check.durationMs"
                class="text-xs text-muted"
              >
                &middot; {{ check.durationMs }}ms
              </span>
            </div>
            <p
              v-if="check.status === 'online'"
              class="text-xs text-muted mt-0.5"
            >
              <template v-if="check.serverInfo?.uptime">
                &uarr; {{ check.serverInfo.uptime }}
              </template>
              <template v-if="check.resources">
                &nbsp;&middot; {{ check.resources.cpuCores }} vCPU
                &middot; {{ Math.round((check.resources.memoryMb ?? 0) / 1024) }} GB RAM
                &middot; {{ check.resources.diskGb }} GB disk
              </template>
            </p>
            <p
              v-if="check.error"
              class="text-xs text-error mt-0.5"
            >
              {{ check.error }}
            </p>
          </div>
        </div>
      </div>

      <!-- Empty state -->
      <div
        v-else
        class="px-4 py-8 text-center"
      >
        <UIcon
          name="i-lucide-activity"
          class="mx-auto mb-2 size-7 text-muted"
        />
        <p class="text-sm text-muted">
          No health checks run yet. Click "Check Now" to start.
        </p>
      </div>
    </div>

    <!-- Apps on this server -->
    <div class="rounded-xl border border-default bg-elevated/50 divide-y divide-default">
      <div class="flex items-center justify-between px-4 py-3">
        <h2 class="font-medium text-highlighted">
          Apps
          <span
            v-if="!appsLoading && serverApps.length"
            class="ml-1.5 text-xs text-muted font-normal"
          >({{ serverApps.length }})</span>
        </h2>
        <NuxtLink
          to="/dashboard/apps"
          class="text-xs text-primary hover:underline"
        >
          Manage apps
        </NuxtLink>
      </div>

      <div
        v-if="appsLoading"
        class="divide-y divide-default"
      >
        <div
          v-for="i in 2"
          :key="i"
          class="flex items-center gap-3 px-4 py-3"
        >
          <USkeleton class="size-7 rounded-lg shrink-0" />
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-3 w-48" />
          </div>
          <USkeleton class="h-5 w-16 rounded-full" />
        </div>
      </div>

      <div
        v-else-if="serverApps.length"
        class="divide-y divide-default"
      >
        <NuxtLink
          v-for="app in serverApps"
          :key="app._id"
          :to="`/dashboard/apps/${app._id}`"
          class="flex items-center gap-3 px-4 py-3 hover:bg-elevated transition-colors"
        >
          <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
            <UIcon
              name="i-lucide-box"
              class="size-3.5 text-muted"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-highlighted truncate">
              {{ app.name }}
            </p>
            <p
              v-if="app.proxy?.host"
              class="text-xs text-muted truncate"
            >
              {{ app.proxy.host }}
            </p>
          </div>
          <UBadge
            :color="appStatusColor[app.status] || 'neutral'"
            variant="soft"
            size="xs"
          >
            {{ app.status }}
          </UBadge>
        </NuxtLink>
      </div>

      <div
        v-else
        class="px-4 py-8 text-center"
      >
        <p class="text-sm text-muted">
          No apps deployed to this server yet.
        </p>
      </div>
    </div>

    <!-- Databases on this server -->
    <div class="rounded-xl border border-default bg-elevated/50 divide-y divide-default">
      <div class="flex items-center justify-between px-4 py-3">
        <h2 class="font-medium text-highlighted">
          Databases
          <span
            v-if="!dbsLoading && serverDatabases.length"
            class="ml-1.5 text-xs text-muted font-normal"
          >({{ serverDatabases.length }})</span>
        </h2>
        <NuxtLink
          to="/dashboard/databases"
          class="text-xs text-primary hover:underline"
        >
          Manage databases
        </NuxtLink>
      </div>

      <div
        v-if="dbsLoading"
        class="divide-y divide-default"
      >
        <div
          v-for="i in 2"
          :key="i"
          class="flex items-center gap-3 px-4 py-3"
        >
          <USkeleton class="size-7 rounded-lg shrink-0" />
          <div class="flex-1 space-y-1.5">
            <USkeleton class="h-4 w-32" />
            <USkeleton class="h-3 w-20" />
          </div>
          <USkeleton class="h-5 w-16 rounded-full" />
        </div>
      </div>

      <div
        v-else-if="serverDatabases.length"
        class="divide-y divide-default"
      >
        <NuxtLink
          v-for="db in serverDatabases"
          :key="db._id"
          :to="`/dashboard/databases/${db._id}`"
          class="flex items-center gap-3 px-4 py-3 hover:bg-elevated transition-colors"
        >
          <div class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
            <UIcon
              name="i-lucide-database"
              class="size-3.5 text-muted"
            />
          </div>
          <div class="flex-1 min-w-0">
            <p class="text-sm font-medium text-highlighted truncate">
              {{ db.name }}
            </p>
            <p class="text-xs text-muted">
              {{ db.type }} {{ db.version }}
            </p>
          </div>
          <UBadge
            :color="dbStatusColor[db.status] || 'neutral'"
            variant="soft"
            size="xs"
          >
            {{ db.status }}
          </UBadge>
        </NuxtLink>
      </div>

      <div
        v-else
        class="px-4 py-8 text-center"
      >
        <p class="text-sm text-muted">
          No databases provisioned on this server yet.
        </p>
      </div>
    </div>

    <!-- Delete confirmation modal -->
    <UModal
      v-model:open="deleteOpen"
      title="Delete Server"
    >
      <template #body>
        <div class="space-y-4">
          <div class="flex items-start gap-3">
            <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-error/10">
              <UIcon
                name="i-lucide-alert-triangle"
                class="size-5 text-error"
              />
            </div>
            <p class="text-sm text-muted pt-1.5">
              This will permanently delete the server
              <span class="font-semibold text-highlighted">{{ server?.name }}</span>
              and all associated data. This action cannot be undone.
            </p>
          </div>
          <UFormField :label="`Type &quot;${server?.name}&quot; to confirm`">
            <UInput
              v-model="deleteConfirmName"
              :placeholder="server?.name"
              class="w-full"
              autofocus
            />
          </UFormField>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="deleteOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="deleting"
          :disabled="!deleteConfirmMatch"
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Server
        </UButton>
      </template>
    </UModal>
  </div>
</template>
