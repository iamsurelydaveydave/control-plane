<script setup lang="ts">
import { z } from 'zod'

/**
 * NodeForm — Form component for Node resource.
 *
 * Supports three modes:
 * - 'add': Generate a join token for a new worker node
 * - 'view': Read-only display of node details
 * - 'edit': Limited editing (name only)
 *
 * Never calls API functions — only emits events (submit, close, edit, delete).
 * Uses defineModel for two-way binding of the node object and error message.
 */
const props = withDefaults(
  defineProps<{
    title?: string
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
  }>(),
  {
    title: '',
    mode: 'add',
    loading: false
  }
)

const emit = defineEmits<{
  close: []
  submit: []
  edit: []
  delete: []
}>()

// Two-way binding via defineModel — parent owns the state
const message = defineModel<string>('message', { default: '' })
const node = defineModel<TNode>({ required: true })

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

const isMutable = computed(() => ['add', 'edit'].includes(props.mode))

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'add': return 'Generate Join Token'
    case 'edit': return 'Save changes'
    default: return ''
  }
})

const formTitle = computed(() => {
  if (props.title) return props.title
  switch (props.mode) {
    case 'add': return 'Add Worker Node'
    case 'edit': return 'Edit Node'
    case 'view': return 'Node Details'
    default: return 'Node'
  }
})

// ---------------------------------------------------------------------------
// Form validation schemas
// ---------------------------------------------------------------------------

const addSchema = z.object({
  name: z.string()
    .min(1, 'Node name is required')
    .max(63, 'Name must be 63 characters or less')
    .regex(
      /^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/,
      'Must be lowercase alphanumeric with hyphens, cannot start/end with hyphen'
    )
})

const editSchema = z.object({
  name: z.string()
    .min(1, 'Node name is required')
    .max(63, 'Name must be 63 characters or less')
})

const schema = computed(() => props.mode === 'add' ? addSchema : editSchema)

// More actions menu for view mode
const moreActions = computed(() => [[
  { label: 'Edit', icon: 'i-lucide-pencil', onSelect: () => emit('edit') },
  { label: 'Delete', icon: 'i-lucide-trash-2', class: 'text-error', onSelect: () => emit('delete') }
]])

// ---------------------------------------------------------------------------
// Status badge colors
// ---------------------------------------------------------------------------

function statusColor(status: TNodeStatus): 'success' | 'warning' | 'error' | 'info' | 'neutral' {
  switch (status) {
    case 'ready': return 'success'
    case 'pending':
    case 'joining': return 'warning'
    case 'not-ready':
    case 'offline': return 'error'
    case 'draining':
    case 'deleting': return 'info'
    default: return 'neutral'
  }
}

function roleColor(role: TNodeRole): 'primary' | 'neutral' {
  return role === 'master' ? 'primary' : 'neutral'
}

function conditionStatusColor(status: string): 'success' | 'error' | 'neutral' {
  switch (status) {
    case 'True': return 'success'
    case 'False': return 'error'
    default: return 'neutral'
  }
}

// ---------------------------------------------------------------------------
// Copy to clipboard
// ---------------------------------------------------------------------------

const copied = ref(false)

async function copyJoinCommand() {
  if (!node.value.joinCommand) return
  try {
    await navigator.clipboard.writeText(node.value.joinCommand)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // Fallback for older browsers
    const textarea = document.createElement('textarea')
    textarea.value = node.value.joinCommand
    document.body.appendChild(textarea)
    textarea.select()
    document.execCommand('copy')
    document.body.removeChild(textarea)
    copied.value = true
    setTimeout(() => {
      copied.value = false
    }, 2000)
  }
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatDate(dateStr?: string): string {
  if (!dateStr) return '—'
  return new Date(dateStr).toLocaleString()
}

function formatRelativeTime(dateStr?: string): string {
  if (!dateStr) return '—'
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return formatDate(dateStr)
}

const labelEntries = computed(() => {
  if (!node.value.labels) return []
  return Object.entries(node.value.labels)
})
</script>

<template>
  <div class="space-y-4 p-4">
    <!-- Modal header -->
    <div class="font-semibold text-lg">{{ formTitle }}</div>

    <!-- ══════════════════════════════════════════════════════════════════════
         ADD MODE: Generate join token form
         ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="mode === 'add'">
      <UForm
        :schema="schema"
        :state="node"
        class="space-y-4"
        @submit="emit('submit')"
      >
        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="How it works"
          description="Enter a name for your worker node, then run the generated command on your VM to join it to the cluster."
        />

        <UFormField
          label="Node Name"
          name="name"
          hint="Used to identify the node in the cluster"
          required
        >
          <UInput
            v-model="node.name"
            placeholder="worker-1"
            icon="i-lucide-hard-drive"
            :readonly="!isMutable"
            class="w-full"
          />
        </UFormField>

        <!-- Error message -->
        <UAlert
          v-if="message"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :description="message"
          @close="message = ''"
        />
      </UForm>
    </template>

    <!-- ══════════════════════════════════════════════════════════════════════
         VIEW MODE: Node details
         ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="mode === 'view'">
      <!-- Basic info -->
      <div class="space-y-4">
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Name">
            <span class="text-sm font-mono">{{ node.name }}</span>
          </UFormField>
          <UFormField label="Role">
            <UBadge
              :color="roleColor(node.role)"
              :label="node.role"
              variant="subtle"
            />
          </UFormField>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Status">
            <div class="flex items-center gap-2">
              <UBadge
                :color="statusColor(node.status)"
                :label="node.status"
                variant="subtle"
              />
              <UIcon
                v-if="node.unschedulable"
                name="i-lucide-ban"
                class="size-4 text-warning"
                title="Cordoned - unschedulable"
              />
            </div>
          </UFormField>
          <UFormField label="Host / IP">
            <span class="text-sm font-mono">{{ node.host || '—' }}</span>
          </UFormField>
        </div>
      </div>

      <!-- Kubernetes info -->
      <template v-if="node.k8sName || node.k8sVersion">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-box"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Kubernetes</span>
          </div>
        </USeparator>

        <div class="grid grid-cols-2 gap-4">
          <UFormField
            v-if="node.k8sName"
            label="Kubernetes Name"
          >
            <span class="text-sm font-mono">{{ node.k8sName }}</span>
          </UFormField>
          <UFormField
            v-if="node.k8sVersion"
            label="Version"
          >
            <span class="text-sm font-mono">{{ node.k8sVersion }}</span>
          </UFormField>
          <UFormField
            v-if="node.osImage"
            label="OS"
          >
            <span class="text-sm">{{ node.osImage }}</span>
          </UFormField>
          <UFormField
            v-if="node.architecture"
            label="Architecture"
          >
            <span class="text-sm font-mono">{{ node.architecture }}</span>
          </UFormField>
          <UFormField
            v-if="node.containerRuntime"
            label="Container Runtime"
          >
            <UBadge
              color="neutral"
              :label="node.containerRuntime"
              variant="subtle"
            />
          </UFormField>
        </div>
      </template>

      <!-- Resources -->
      <template v-if="node.resources">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-cpu"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Resources</span>
          </div>
        </USeparator>

        <div class="grid grid-cols-3 gap-4">
          <div class="rounded-lg border border-default bg-elevated/50 p-3">
            <span class="text-xs text-muted uppercase tracking-wide mb-1 block">CPU</span>
            <span class="text-lg font-semibold block">{{ node.resources.cpuCapacity || '—' }}</span>
            <span class="text-xs text-muted block">{{ node.resources.cpuAllocatable || '' }} allocatable</span>
          </div>
          <div class="rounded-lg border border-default bg-elevated/50 p-3">
            <span class="text-xs text-muted uppercase tracking-wide mb-1 block">Memory</span>
            <span class="text-lg font-semibold block">{{ node.resources.memoryCapacity || '—' }}</span>
            <span class="text-xs text-muted block">{{ node.resources.memoryAllocatable || '' }} allocatable</span>
          </div>
          <div class="rounded-lg border border-default bg-elevated/50 p-3">
            <span class="text-xs text-muted uppercase tracking-wide mb-1 block">Pods</span>
            <span class="text-lg font-semibold block">
              {{ node.resources.podsRunning || 0 }} / {{ node.resources.podsCapacity || '—' }}
            </span>
            <span class="text-xs text-muted block">running / capacity</span>
          </div>
        </div>
      </template>

      <!-- Conditions -->
      <template v-if="node.conditions?.length">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-activity"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Conditions</span>
          </div>
        </USeparator>

        <div class="rounded-lg border border-default divide-y divide-default">
          <div
            v-for="condition in node.conditions"
            :key="condition.type"
            class="flex items-center justify-between px-3 py-2"
          >
            <div class="flex items-center gap-2">
              <span class="text-sm font-medium">{{ condition.type }}</span>
              <span
                :class="[
                  'size-2 rounded-full',
                  conditionStatusColor(condition.status) === 'success' ? 'bg-success' :
                  conditionStatusColor(condition.status) === 'error' ? 'bg-error' : 'bg-neutral'
                ]"
              />
            </div>
            <UBadge
              :color="conditionStatusColor(condition.status)"
              :label="condition.status"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>
      </template>

      <!-- Labels -->
      <template v-if="labelEntries.length">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-tags"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Labels</span>
            <UBadge
              color="neutral"
              :label="String(labelEntries.length)"
              variant="subtle"
              size="xs"
            />
          </div>
        </USeparator>

        <div class="flex flex-wrap gap-2">
          <UBadge
            v-for="[key, value] in labelEntries"
            :key="key"
            color="neutral"
            variant="subtle"
            size="sm"
          >
            <span class="font-mono text-xs">{{ key }}={{ value }}</span>
          </UBadge>
        </div>
      </template>

      <!-- Taints -->
      <template v-if="node.taints?.length">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-shield-alert"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Taints</span>
            <UBadge
              color="warning"
              :label="String(node.taints.length)"
              variant="subtle"
              size="xs"
            />
          </div>
        </USeparator>

        <div class="rounded-lg border border-default divide-y divide-default">
          <div
            v-for="taint in node.taints"
            :key="taint.key"
            class="flex items-center justify-between px-3 py-2"
          >
            <span class="text-sm font-mono">
              {{ taint.key }}{{ taint.value ? `=${taint.value}` : '' }}
            </span>
            <UBadge
              color="warning"
              :label="taint.effect"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>
      </template>

      <!-- Join command (for pending nodes) -->
      <template v-if="node.joinCommand && ['pending', 'joining'].includes(node.status)">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-terminal"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Join Command</span>
          </div>
        </USeparator>

        <UAlert
          color="warning"
          variant="soft"
          icon="i-lucide-alert-triangle"
          title="Run this command on your worker VM"
        >
          <template #description>
            <p class="text-sm mb-2">
              Run as root to join the node to the cluster.
            </p>
          </template>
        </UAlert>

        <div class="relative">
          <pre class="bg-elevated rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all border border-default">{{ node.joinCommand }}</pre>
          <UButton
            class="absolute right-2 top-2"
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :color="copied ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            @click="copyJoinCommand"
          />
        </div>
      </template>

      <!-- Timestamps -->
      <USeparator>
        <div class="flex items-center gap-2 px-2">
          <UIcon
            name="i-lucide-clock"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">Timeline</span>
        </div>
      </USeparator>

      <div class="grid grid-cols-3 gap-4 text-sm">
        <UFormField label="Created">
          <span class="text-muted">{{ formatDate(node.createdAt) }}</span>
        </UFormField>
        <UFormField label="Joined">
          <span class="text-muted">{{ formatDate(node.joinedAt) }}</span>
        </UFormField>
        <UFormField label="Last Seen">
          <span class="text-muted">
            {{ node.lastSeenAt ? formatRelativeTime(node.lastSeenAt) : '—' }}
          </span>
        </UFormField>
      </div>

      <!-- Error message (view mode) -->
      <UAlert
        v-if="node.status === 'offline'"
        color="error"
        variant="soft"
        icon="i-lucide-wifi-off"
        title="Node Offline"
        description="This node has not been seen recently. Check the node's network connectivity and kubelet status."
      />

      <UAlert
        v-if="node.provisioningStatus === 'failed'"
        color="error"
        variant="soft"
        icon="i-lucide-circle-x"
        title="Provisioning Failed"
        description="Node provisioning failed. Check the provisioning logs for details."
      />
    </template>

    <!-- ══════════════════════════════════════════════════════════════════════
         EDIT MODE: Limited editing (name only)
         ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="mode === 'edit'">
      <UForm
        :schema="schema"
        :state="node"
        class="space-y-4"
        @submit="emit('submit')"
      >
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="node.name"
            placeholder="worker-1"
            :readonly="!isMutable"
            class="w-full"
          />
        </UFormField>

        <UFormField label="Role">
          <UBadge
            :color="roleColor(node.role)"
            :label="node.role"
            variant="subtle"
          />
          <span class="text-xs text-muted mt-1 block">Node role cannot be changed after creation</span>
        </UFormField>

        <UFormField label="Host / IP">
          <span class="text-sm font-mono">{{ node.host || '—' }}</span>
          <span class="text-xs text-muted mt-1 block">Host is determined by the node itself</span>
        </UFormField>

        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="Managing labels"
          description="Use the node actions menu to add or remove labels on this node."
        />

        <!-- Error message -->
        <UAlert
          v-if="message"
          color="error"
          variant="soft"
          icon="i-lucide-circle-alert"
          :description="message"
          @close="message = ''"
        />
      </UForm>
    </template>

    <!-- ══════════════════════════════════════════════════════════════════════
         FOOTER ACTION BAR
         ══════════════════════════════════════════════════════════════════════ -->
    <div class="sticky bottom-0 flex items-center justify-end gap-2 border-t border-default bg-default px-4 py-3">
      <!-- Cancel / Close -->
      <UButton
        variant="ghost"
        color="neutral"
        :disabled="loading"
        @click="emit('close')"
      >
        {{ isMutable ? 'Cancel' : 'Close' }}
      </UButton>

      <!-- View mode: More actions menu -->
      <UDropdownMenu v-if="mode === 'view'" :items="moreActions">
        <UButton color="neutral" trailing-icon="i-lucide-chevron-down">More actions</UButton>
      </UDropdownMenu>

      <!-- Add/Edit mode: Submit button -->
      <UButton
        v-if="isMutable"
        :loading="loading"
        @click="emit('submit')"
      >
        {{ submitLabel }}
      </UButton>
    </div>
  </div>
</template>
