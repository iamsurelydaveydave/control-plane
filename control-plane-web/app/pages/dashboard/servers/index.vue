<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, setupServer, testConnection } = useServer()
const { getAll: getAllSSHKeys } = useSSHKey()

// ── SSH key helpers ──────────────────────────────────────────────────────────

const { data: sshKeysData } = useLazyAsyncData(
  'ssh-keys-dropdown',
  () => getAllSSHKeys().catch(() => ({ items: [] })),
  { server: false }
)
const sshKeyOptions = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.map(k => ({ value: k._id, label: k.name + (k.isDefault ? ' (default)' : '') }))
})
const defaultSSHKey = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.find(k => k.isDefault)
})

// ── Server list ──────────────────────────────────────────────────────────────

const { data: servers, refresh, status } = useLazyAsyncData(
  'servers',
  () => getAll({ page: 1 }).catch(() => ({ items: [], pages: 0 })),
  { server: false }
)
const loading = computed(() => status.value === 'pending')
const items = computed(() => servers.value?.items ?? [])

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  online: 'success',
  offline: 'error',
  provisioning: 'warning',
  unknown: 'neutral'
}

// ── SSE: real-time setup progress for provisioning servers ──────────────────

const sseConnections = new Map<string, EventSource>()

function connectServerSSE(server: TServer) {
  if (sseConnections.has(server._id)) return
  const es = new EventSource(`/api/servers/${server._id}/setup-stream`)

  es.addEventListener('update', (e: MessageEvent) => {
    const update = JSON.parse(e.data)
    const idx = servers.value?.items.findIndex(s => s._id === server._id) ?? -1
    if (idx !== -1 && servers.value?.items) {
      Object.assign(servers.value.items[idx], update)
    }
  })

  es.addEventListener('done', () => {
    es.close()
    sseConnections.delete(server._id)
  })

  es.onerror = () => {
    es.close()
    sseConnections.delete(server._id)
  }

  sseConnections.set(server._id, es)
}

watch(items, (newItems) => {
  newItems.forEach(s => {
    if ((s.setupStatus === 'running' || s.status === 'provisioning') && !sseConnections.has(s._id)) {
      connectServerSSE(s)
    }
  })
}, { immediate: true })

onUnmounted(() => {
  sseConnections.forEach(es => es.close())
  sseConnections.clear()
})

// ── Retry setup from list ────────────────────────────────────────────────────

const retryingId = ref<string | null>(null)

async function handleRetrySetup(server: TServer, event: Event) {
  event.preventDefault()
  if (retryingId.value) return
  retryingId.value = server._id
  try {
    const { setupServer } = useServer()
    await setupServer(server._id)
    connectServerSSE(server)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to start setup', color: 'error' })
  } finally {
    retryingId.value = null
  }
}

// ── Add server dialog ────────────────────────────────────────────────────────

const addOpen = ref(false)
const adding = ref(false)
const testing = ref(false)
const connectionStatus = ref<{
  success: boolean
  error?: string
  serverInfo?: { os: string, hostname: string, uptime: string }
} | null>(null)

const form = reactive({
  name: '',
  host: '',
  sshUser: 'root',
  sshPort: 22,
  sshKeyId: '' as string | undefined
})

function openAdd() {
  Object.assign(form, {
    name: '',
    host: '',
    sshUser: 'root',
    sshPort: 22,
    sshKeyId: defaultSSHKey.value?._id ?? ''
  })
  connectionStatus.value = null
  addOpen.value = true
}

async function handleTestConnection() {
  if (!form.host || !form.sshKeyId || testing.value) return
  testing.value = true
  connectionStatus.value = null
  try {
    const result = await testConnection({
      host: form.host,
      sshUser: form.sshUser,
      sshPort: form.sshPort,
      sshKeyId: form.sshKeyId
    })
    connectionStatus.value = result
    if (result.success) {
      toast.add({ title: 'Connection successful', description: `Connected to ${result.serverInfo?.hostname}`, color: 'success', icon: 'i-lucide-check' })
    } else {
      toast.add({ title: 'Connection failed', description: result.error, color: 'error', icon: 'i-lucide-x' })
    }
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    connectionStatus.value = { success: false, error: err?.data?.message || 'Connection test failed' }
    toast.add({ title: 'Connection test failed', description: err?.data?.message || 'Unknown error', color: 'error' })
  } finally {
    testing.value = false
  }
}

async function submitAdd() {
  if (!form.name || !form.host || !form.sshKeyId || adding.value) return
  adding.value = true
  try {
    const { serverId } = await add({
      name: form.name,
      host: form.host,
      sshUser: form.sshUser,
      sshPort: form.sshPort,
      sshKeyId: form.sshKeyId
    })
    // Kick off setup immediately (fire-and-forget — detail page polls progress)
    setupServer(serverId).catch(() => {})
    addOpen.value = false
    await navigateTo(`/dashboard/servers/${serverId}`)
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to add server', color: 'error' })
  } finally {
    adding.value = false
  }
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

const copiedHostId = ref<string | null>(null)
async function copyHost(server: TServer, event: Event) {
  event.preventDefault()
  await navigator.clipboard.writeText(server.host)
  copiedHostId.value = server._id
  setTimeout(() => { copiedHostId.value = null }, 2000)
}

useHead({ title: 'Servers · Control Plane' })
</script>

<template>
  <div class="space-y-4">
    <!-- Header -->
    <div class="flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          Servers
        </h1>
        <p class="text-sm text-muted">
          Manage your server infrastructure.
        </p>
      </div>
      <UButton
        icon="i-lucide-plus"
        @click="openAdd"
      >
        Add Server
      </UButton>
    </div>

    <!-- Loading skeleton -->
    <div
      v-if="loading"
      class="space-y-2"
    >
      <USkeleton
        v-for="i in 3"
        :key="i"
        class="h-16 rounded-xl"
      />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="!items.length"
      class="rounded-xl border border-default bg-elevated/50 p-12 text-center"
    >
      <UIcon
        name="i-lucide-server"
        class="mx-auto mb-3 size-10 text-muted"
      />
      <h3 class="font-medium text-highlighted">
        No servers yet
      </h3>
      <p class="mt-1 text-sm text-muted mb-4">
        Add your first server to start deploying apps.
      </p>
      <UButton
        variant="subtle"
        icon="i-lucide-plus"
        @click="openAdd"
      >
        Add Server
      </UButton>
    </div>

    <!-- Server list -->
    <div
      v-else
      class="space-y-2"
    >
      <NuxtLink
        v-for="server in items"
        :key="server._id"
        :to="`/dashboard/servers/${server._id}`"
        class="flex items-center justify-between rounded-xl border border-default bg-elevated/50 px-4 py-3.5 hover:bg-elevated transition-colors"
      >
        <div class="flex items-center gap-3 min-w-0">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
            <UIcon
              :name="server.status === 'provisioning' ? 'i-lucide-loader' : 'i-lucide-server'"
              :class="['size-4', server.status === 'provisioning' ? 'text-warning animate-spin' : 'text-muted']"
            />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-medium text-highlighted">{{ server.name }}</span>
              <UBadge
                :color="statusColor[server.status] || 'neutral'"
                variant="soft"
                size="xs"
              >
                {{ server.status === 'provisioning' ? 'setting up…' : server.status }}
              </UBadge>
            </div>
            <div class="flex items-center gap-1 mt-0.5">
              <span class="text-xs text-muted font-mono">{{ maskHost(server.host) }}</span>
              <button
                class="text-muted hover:text-highlighted transition-colors p-0.5 rounded"
                :title="copiedHostId === server._id ? 'Copied!' : 'Copy IP'"
                @click.prevent="copyHost(server, $event)"
              >
                <UIcon
                  :name="copiedHostId === server._id ? 'i-lucide-check' : 'i-lucide-copy'"
                  :class="['size-3', copiedHostId === server._id ? 'text-success' : '']"
                />
              </button>
              <template v-if="server.sshUser">
                <span class="text-xs text-muted">· {{ server.sshUser }}@{{ server.sshPort || 22 }}</span>
              </template>
              <template v-if="server.resources">
                <span class="text-xs text-muted">
                  · {{ server.resources.cpuCores }} vCPU
                  · {{ Math.round(server.resources.memoryMb / 1024) }} GB RAM
                  · {{ server.resources.diskGb }} GB disk
                </span>
              </template>
            </div>
          </div>
        </div>
        <!-- Retry button for failed setups -- stops link navigation -->
        <UButton
          v-if="server.setupStatus === 'failed'"
          size="xs"
          color="error"
          variant="soft"
          icon="i-lucide-refresh-cw"
          :loading="retryingId === server._id"
          title="Retry setup"
          @click="handleRetrySetup(server, $event)"
        />
        <UIcon
          name="i-lucide-chevron-right"
          class="size-4 text-muted shrink-0"
        />
      </NuxtLink>
    </div>

    <!-- Add server modal -->
    <UModal
      v-model:open="addOpen"
      title="Add Server"
    >
      <template #body>
        <div class="space-y-4">
          <div class="grid grid-cols-2 gap-3">
            <UFormField label="Server name">
              <UInput
                v-model="form.name"
                placeholder="my-server"
                class="w-full"
              />
            </UFormField>
            <UFormField label="Host (IP or hostname)">
              <UInput
                v-model="form.host"
                placeholder="192.168.1.100"
                class="w-full"
              />
            </UFormField>
          </div>

          <div class="grid grid-cols-2 gap-3">
            <UFormField label="SSH user">
              <UInput
                v-model="form.sshUser"
                placeholder="root"
                class="w-full"
              />
            </UFormField>
            <UFormField label="SSH port">
              <UInput
                v-model.number="form.sshPort"
                type="number"
                placeholder="22"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField label="SSH key">
            <USelect
              v-model="form.sshKeyId"
              :items="sshKeyOptions"
              placeholder="Select SSH key"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                <template v-if="!sshKeyOptions.length">
                  No SSH keys available.
                  <NuxtLink
                    to="/dashboard/settings/ssh-keys"
                    class="text-primary underline"
                  >Create one</NuxtLink> first.
                </template>
                <template v-else>
                  Select the SSH key to use for connecting to this server.
                </template>
              </span>
            </template>
          </UFormField>

          <!-- Test connection -->
          <div
            v-if="form.host && form.sshKeyId"
            class="flex items-center gap-3"
          >
            <UButton
              color="neutral"
              variant="outline"
              icon="i-lucide-plug"
              :loading="testing"
              @click="handleTestConnection"
            >
              Test Connection
            </UButton>
            <div
              v-if="connectionStatus"
              class="flex items-center gap-2"
            >
              <UIcon
                :name="connectionStatus.success ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
                :class="connectionStatus.success ? 'text-success' : 'text-error'"
                class="size-5"
              />
              <span
                :class="connectionStatus.success ? 'text-success' : 'text-error'"
                class="text-sm"
              >
                {{ connectionStatus.success ? 'Connected' : connectionStatus.error }}
              </span>
            </div>
          </div>

          <!-- Connection info -->
          <UAlert
            v-if="connectionStatus?.success && connectionStatus.serverInfo"
            color="success"
            variant="soft"
            icon="i-lucide-server"
            title="Server information"
          >
            <template #description>
              <dl class="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <dt class="text-muted">Hostname</dt>
                  <dd class="font-mono">{{ connectionStatus.serverInfo.hostname }}</dd>
                </div>
                <div>
                  <dt class="text-muted">Uptime</dt>
                  <dd class="font-mono">{{ connectionStatus.serverInfo.uptime }}</dd>
                </div>
                <div class="col-span-3">
                  <dt class="text-muted">OS</dt>
                  <dd class="font-mono truncate">{{ connectionStatus.serverInfo.os }}</dd>
                </div>
              </dl>
            </template>
          </UAlert>

          <UAlert
            v-else-if="!sshKeyOptions.length"
            color="error"
            variant="soft"
            icon="i-lucide-alert-triangle"
            title="No SSH keys available"
          >
            <template #description>
              You need to create an SSH key before adding a server.
              <NuxtLink
                to="/dashboard/settings/ssh-keys"
                class="underline font-medium"
              >Go to SSH Keys</NuxtLink>
            </template>
          </UAlert>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="addOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="adding"
          :disabled="!form.name || !form.host || !form.sshKeyId"
          icon="i-lucide-server"
          @click="submitAdd"
        >
          Add & Setup Server
        </UButton>
      </template>
    </UModal>
  </div>
</template>
