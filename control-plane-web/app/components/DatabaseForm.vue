<script setup lang="ts">
/**
 * DatabaseForm — multi-node database creation form.
 *
 * 'add' mode: node builder + resource shape + auth.
 * 'view' mode: read-only database details.
 * The action bar (Cancel / Submit) lives in the parent modal's #footer slot.
 */
const props = withDefaults(
  defineProps<{
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
    servers?: TServer[]
  }>(),
  {
    mode: 'add',
    loading: false,
    servers: () => []
  }
)

const message = defineModel<string>('message', { default: '' })

const database = defineModel<TDatabase & {
  formNodes?: TDatabaseNodeForm[]
  shape?: TDatabaseShape
  adminUser?: string
  adminPassword?: string
}>('database', {
  default: () => ({
    _id: '',
    name: '',
    type: 'mongodb',
    version: '7.0',
    status: 'unknown',
    adminUser: 'admin',
    adminPassword: '',
    formNodes: [{ serverId: '', role: 'standalone' as const }],
    shape: { cacheSizeGB: 0.5, port: 27017, replicaSetName: '' }
  })
})

const isMutable = computed(() => props.mode === 'add' || props.mode === 'edit')

// ---------------------------------------------------------------------------
// Node builder
// ---------------------------------------------------------------------------

const nodes = computed({
  get: (): TDatabaseNodeForm[] =>
    database.value.formNodes ?? [{ serverId: '', role: 'standalone' }],
  set: (val: TDatabaseNodeForm[]) => { database.value.formNodes = val }
})

const isReplicaSet = computed(() => nodes.value.length > 1)

const roleOptions = computed(() => {
  if (!isReplicaSet.value) {
    return [{ value: 'standalone', label: 'Standalone' }]
  }
  return [
    { value: 'primary', label: 'Primary — handles all writes' },
    { value: 'secondary', label: 'Secondary — data replica' },
    { value: 'arbiter', label: 'Arbiter — voting only, no data' }
  ]
})

function addNode() {
  const current: TDatabaseNodeForm[] = nodes.value.map(n => ({ ...n }))
  const first = current[0]
  if (current.length === 1 && first && first.role === 'standalone') {
    current[0] = { serverId: first.serverId, role: 'primary' }
  }
  current.push({ serverId: '', role: 'secondary' })
  nodes.value = current
  syncReplicaSetName()
}

function removeNode(index: number) {
  const current: TDatabaseNodeForm[] = nodes.value
    .filter((_, i) => i !== index)
    .map(n => ({ ...n }))
  const first = current[0]
  if (current.length === 1 && first) {
    current[0] = { serverId: first.serverId, role: 'standalone' }
  }
  nodes.value = current
  syncReplicaSetName()
}

function syncReplicaSetName() {
  const shape = database.value.shape
  if (!shape) return
  if (isReplicaSet.value && !shape.replicaSetName && database.value.name) {
    shape.replicaSetName = `rs_${database.value.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}`
  }
}

watch(() => database.value.name, syncReplicaSetName)

// ---------------------------------------------------------------------------
// Server helpers
// ---------------------------------------------------------------------------

const serverMap = computed(() => {
  const m: Record<string, TServer> = {}
  for (const s of props.servers) {
    m[s._id] = s
  }
  return m
})

const availableServerItems = computed(() =>
  props.servers.map(s => ({
    value: s._id,
    label: `${s.name} (${s.host})`
  }))
)

function otherSelectedIds(currentIndex: number): string[] {
  return nodes.value
    .filter((_, i) => i !== currentIndex)
    .map(n => n.serverId)
    .filter(Boolean)
}

// ---------------------------------------------------------------------------
// Resource warnings per node
// ---------------------------------------------------------------------------

function getNodeWarnings(node: TDatabaseNodeForm, index: number): string[] {
  const warnings: string[] = []
  if (!node.serverId) return warnings

  const server = serverMap.value[node.serverId]
  if (!server) return warnings

  const cacheSizeGB = database.value.shape?.cacheSizeGB ?? 0.5
  if (server.resources?.memoryMb) {
    const requiredMb = cacheSizeGB * 1024 + 700
    const pct = Math.round((requiredMb / server.resources.memoryMb) * 100)
    if (pct > 80) {
      const reqGb = Math.round(requiredMb / 1024 * 10) / 10
      const totGb = Math.round(server.resources.memoryMb / 1024 * 10) / 10
      warnings.push(
        `${cacheSizeGB} GB cache + baseline ≈ ${reqGb} GB — ${pct}% of this server's ${totGb} GB RAM`
      )
    }
  }

  if (otherSelectedIds(index).includes(node.serverId)) {
    warnings.push('This server is already selected for another node.')
  }

  return warnings
}

function getNodeInfo(node: TDatabaseNodeForm): string | null {
  if (!node.serverId) return null
  const s = serverMap.value[node.serverId]
  if (!s?.resources) return null
  const { cpuCores, memoryMb, diskGb } = s.resources
  const parts: string[] = []
  if (cpuCores) parts.push(`${cpuCores} vCPU`)
  if (memoryMb) parts.push(`${Math.round(memoryMb / 1024 * 10) / 10} GB RAM`)
  if (diskGb) parts.push(`${diskGb} GB disk`)
  return parts.join(' · ') || null
}

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  database.value.adminPassword = Array.from(
    { length: 24 },
    () => chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}

// ---------------------------------------------------------------------------
// Status helper (view mode)
// ---------------------------------------------------------------------------

function statusColor(s: string) {
  switch (s) {
    case 'running': return 'success'
    case 'provisioning': return 'warning'
    case 'failed': return 'error'
    default: return 'neutral'
  }
}
</script>

<template>
  <div class="p-6 space-y-6">
    <!-- ── Section 1: Cluster ─────────────────────────── -->
    <div class="space-y-4">
      <UFormField
        label="Name"
        required
      >
        <UInput
          v-model="database.name"
          placeholder="my-replica-set"
          :disabled="!isMutable"
          class="w-full"
        />
      </UFormField>

      <div class="grid grid-cols-2 gap-4">
        <UFormField
          label="Type"
          required
        >
          <USelect
            v-model="database.type"
            :items="[
              { value: 'mongodb', label: 'MongoDB' },
              { value: 'redis', label: 'Redis' },
              { value: 'postgresql', label: 'PostgreSQL' },
              { value: 'mysql', label: 'MySQL' }
            ]"
            :disabled="!isMutable || mode === 'edit'"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Version">
          <UInput
            v-model="database.version"
            placeholder="7.0"
            :disabled="!isMutable"
            class="w-full"
          />
        </UFormField>
      </div>
    </div>

    <!-- ── Section 2: Nodes ───────────────────────────── -->
    <template v-if="mode === 'add'">
      <USeparator>
        <div class="flex items-center gap-2 px-2">
          <UIcon
            name="i-lucide-server"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">Nodes</span>
          <UBadge
            :label="isReplicaSet ? 'Replica Set' : 'Standalone'"
            :color="isReplicaSet ? 'primary' : 'neutral'"
            variant="subtle"
            size="xs"
          />
        </div>
      </USeparator>

      <UAlert
        v-if="!servers.length"
        color="warning"
        variant="soft"
        icon="i-lucide-server"
        title="No ready servers"
      >
        <template #description>
          <p>
            Servers must be <strong>online with Docker installed</strong>.
            <NuxtLink
              to="/dashboard/servers"
              class="underline font-medium ml-1"
            >
              Set up a server first →
            </NuxtLink>
          </p>
        </template>
      </UAlert>

      <div
        v-else
        class="space-y-3"
      >
        <!-- Node rows -->
        <UFormField
          v-for="(node, index) in nodes"
          :key="index"
          :label="`Node ${index + 1}`"
        >
          <div class="rounded-lg border border-default bg-default/30 p-3 space-y-2">
            <div class="flex items-center gap-2">
              <USelect
                v-model="node.serverId"
                :items="availableServerItems"
                placeholder="Select a server"
                class="flex-1"
              />

              <USelect
                v-model="node.role"
                :items="roleOptions"
                class="w-44 shrink-0"
              />

              <UButton
                v-if="nodes.length > 1"
                icon="i-lucide-x"
                color="neutral"
                variant="ghost"
                size="xs"
                class="shrink-0"
                @click="removeNode(index)"
              />
            </div>

            <!-- Server resource info + warnings -->
            <div
              v-if="node.serverId"
              class="space-y-1"
            >
              <p
                v-if="getNodeInfo(node)"
                class="text-xs text-muted flex items-center gap-1"
              >
                <UIcon
                  name="i-lucide-cpu"
                  class="size-3"
                />
                {{ getNodeInfo(node) }}
              </p>

              <p
                v-for="warn in getNodeWarnings(node, index)"
                :key="warn"
                class="text-xs text-warning flex items-start gap-1"
              >
                <UIcon
                  name="i-lucide-alert-triangle"
                  class="size-3 mt-0.5 shrink-0"
                />
                {{ warn }}
              </p>
            </div>
          </div>
        </UFormField>

        <!-- Add node -->
        <UButton
          icon="i-lucide-plus"
          color="neutral"
          variant="outline"
          size="sm"
          :disabled="nodes.length >= servers.length"
          @click="addNode"
        >
          Add Node
          <span class="text-xs text-muted ml-1">({{ nodes.length }}/{{ servers.length }})</span>
        </UButton>

        <!-- 2-node warning -->
        <UAlert
          v-if="isReplicaSet && nodes.length === 2"
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="Consider a 3-node replica set"
          description="Two nodes can't elect a primary if one fails. Add a third node or an arbiter for proper automatic failover."
        />
      </div>
    </template>

    <!-- View mode: nodes list -->
    <template v-if="mode === 'view' && database.nodes?.length">
      <USeparator label="Nodes" />
      <div class="space-y-2">
        <div
          v-for="node in database.nodes"
          :key="String(node.serverId)"
          class="flex items-center justify-between rounded-lg border border-default bg-default/30 px-3 py-2"
        >
          <span class="text-sm font-mono text-muted">{{ node.serverId }}</span>
          <UBadge
            :label="node.role"
            color="neutral"
            variant="outline"
            size="xs"
          />
        </div>
      </div>
    </template>

    <!-- ── Section 3: Resources ───────────────────────── -->
    <template v-if="mode === 'add' && database.type === 'mongodb'">
      <USeparator>
        <div class="flex items-center gap-2 px-2">
          <UIcon
            name="i-lucide-sliders-horizontal"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">Resources</span>
        </div>
      </USeparator>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="WiredTiger Cache (GB)">
          <UInput
            v-model.number="database.shape!.cacheSizeGB"
            type="number"
            min="0.25"
            max="256"
            step="0.25"
            placeholder="0.5"
            class="w-full"
          />
        </UFormField>

        <UFormField label="MongoDB Port">
          <UInput
            v-model.number="database.shape!.port"
            type="number"
            placeholder="27017"
            class="w-full"
          />
        </UFormField>
      </div>

      <UFormField
        v-if="isReplicaSet"
        label="Replica Set Name"
      >
        <UInput
          v-model="database.shape!.replicaSetName"
          placeholder="rs0"
          class="w-full"
        />
      </UFormField>

      <p class="text-sm text-muted">
        Rule of thumb: cache = 50% of available RAM. MongoDB also uses ~700 MB for its own process.
      </p>
    </template>

    <!-- ── Section 4: Authentication ─────────────────── -->
    <template v-if="mode === 'add'">
      <USeparator>
        <div class="flex items-center gap-2 px-2">
          <UIcon
            name="i-lucide-lock"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">Authentication</span>
        </div>
      </USeparator>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="Admin User">
          <UInput
            v-model="database.adminUser"
            placeholder="admin"
            class="w-full"
          />
        </UFormField>

        <UFormField
          label="Admin Password"
          required
        >
          <div class="flex gap-2">
            <UInput
              v-model="database.adminPassword"
              type="password"
              placeholder="••••••••"
              class="flex-1"
            />
            <UButton
              icon="i-lucide-refresh-cw"
              color="neutral"
              variant="outline"
              title="Generate a strong password"
              @click="generatePassword"
            />
          </div>
        </UFormField>
      </div>
    </template>

    <!-- ── View: Status ───────────────────────────────── -->
    <UFormField
      v-if="mode === 'view'"
      label="Status"
    >
      <div class="flex items-center gap-2">
        <UBadge
          :color="statusColor(database.status)"
          :label="database.status"
          variant="subtle"
        />
        <UIcon
          v-if="database.status === 'provisioning'"
          name="i-lucide-loader-2"
          class="size-4 animate-spin text-warning"
        />
      </div>
    </UFormField>

    <!-- Error message -->
    <UAlert
      v-if="message"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="message"
    />
  </div>
</template>
