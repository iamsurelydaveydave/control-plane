<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '#ui/types'

/**
 * NodeForm — Form component for Node resource.
 *
 * Supports three modes:
 * - 'add': Generate a join token for a new worker node
 * - 'view': Read-only display of node details
 * - 'edit': Limited editing (name only)
 *
 * Never calls API functions — only emits events (submit, close, edit, delete).
 */
const props = withDefaults(
  defineProps<{
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
  }>(),
  {
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

const message = defineModel<string>('message', { default: '' })
const node = defineModel<TNode>('node', {
  default: () => ({
    _id: '',
    clusterId: '',
    name: '',
    role: 'worker' as TNodeRole,
    host: '',
    status: 'pending' as TNodeStatus,
    createdAt: '',
    updatedAt: ''
  })
})

// ---------------------------------------------------------------------------
// Computed helpers
// ---------------------------------------------------------------------------

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'add': return 'Generate Join Token'
    case 'edit': return 'Save changes'
    default: return ''
  }
})

// ---------------------------------------------------------------------------
// Add mode: Form validation
// ---------------------------------------------------------------------------

const addSchema = z.object({
  name: z.string().min(1, 'Node name is required').max(63, 'Name must be 63 characters or less')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Must be lowercase alphanumeric with hyphens, cannot start/end with hyphen')
})

type AddFormState = z.output<typeof addSchema>

const addFormState = ref<AddFormState>({
  name: ''
})

function onAddSubmit(event: FormSubmitEvent<AddFormState>) {
  node.value.name = event.data.name
  emit('submit')
}

// ---------------------------------------------------------------------------
// Edit mode: Form validation
// ---------------------------------------------------------------------------

const editSchema = z.object({
  name: z.string().min(1, 'Node name is required').max(63, 'Name must be 63 characters or less')
})

type EditFormState = z.output<typeof editSchema>

const editFormState = computed(() => ({
  name: node.value.name
}))

function onEditSubmit(event: FormSubmitEvent<EditFormState>) {
  node.value.name = event.data.name
  emit('submit')
}

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
  <div class="p-6 space-y-6">
    <!-- ══════════════════════════════════════════════════════════════════════
         ADD MODE: Generate join token form
         ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="mode === 'add'">
      <UForm
        :schema="addSchema"
        :state="addFormState"
        class="space-y-4"
        @submit="onAddSubmit"
      >
        <UFormField
          label="Node Name"
          name="name"
          hint="Used to identify the node in the cluster"
          required
        >
          <UInput
            v-model="addFormState.name"
            placeholder="worker-1"
            class="w-full"
          />
        </UFormField>

        <UAlert
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="How it works"
        >
          <template #description>
            <ol class="list-decimal list-inside text-sm space-y-1">
              <li>Enter a name for your new worker node</li>
              <li>Click "Generate Join Token" to create a join command</li>
              <li>Run the command on your worker server to join it to the cluster</li>
            </ol>
          </template>
        </UAlert>

        <!-- Error message -->
        <UAlert
          v-if="message"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="message"
        />

        <!-- Footer -->
        <div class="flex justify-end gap-2 pt-2 border-t border-default">
          <UButton
            color="neutral"
            variant="outline"
            label="Cancel"
            :disabled="loading"
            @click="emit('close')"
          />
          <UButton
            type="submit"
            :label="submitLabel"
            :loading="loading"
          />
        </div>
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
                v-if="['joining', 'draining', 'deleting'].includes(node.status)"
                name="i-lucide-loader-2"
                class="size-4 animate-spin text-muted"
              />
            </div>
          </UFormField>

          <UFormField label="Host / IP">
            <span class="text-sm font-mono">{{ node.host || '—' }}</span>
          </UFormField>
        </div>
      </div>

      <!-- K8s info -->
      <template v-if="node.k8sName || node.k8sVersion">
        <USeparator>
          <div class="flex items-center gap-2 px-2">
            <UIcon
              name="i-lucide-box"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Kubernetes Info</span>
          </div>
        </USeparator>

        <div class="grid grid-cols-2 gap-4">
          <UFormField
            v-if="node.k8sName"
            label="K8s Node Name"
          >
            <span class="text-sm font-mono">{{ node.k8sName }}</span>
          </UFormField>

          <UFormField
            v-if="node.k8sVersion"
            label="K8s Version"
          >
            <span class="text-sm font-mono">{{ node.k8sVersion }}</span>
          </UFormField>

          <UFormField
            v-if="node.containerRuntime"
            label="Container Runtime"
          >
            <span class="text-sm font-mono">{{ node.containerRuntime }}</span>
          </UFormField>

          <UFormField
            v-if="node.osImage"
            label="OS Image"
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
            v-if="node.unschedulable !== undefined"
            label="Schedulable"
          >
            <UBadge
              :color="node.unschedulable ? 'warning' : 'success'"
              :label="node.unschedulable ? 'Cordoned' : 'Yes'"
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
            <span class="text-lg font-semibold block">{{ node.resources.cpuCapacity }}</span>
            <span class="text-xs text-muted block">{{ node.resources.cpuAllocatable }} allocatable</span>
          </div>

          <div class="rounded-lg border border-default bg-elevated/50 p-3">
            <span class="text-xs text-muted uppercase tracking-wide mb-1 block">Memory</span>
            <span class="text-lg font-semibold block">{{ node.resources.memoryCapacity }}</span>
            <span class="text-xs text-muted block">{{ node.resources.memoryAllocatable }} allocatable</span>
          </div>

          <div class="rounded-lg border border-default bg-elevated/50 p-3">
            <span class="text-xs text-muted uppercase tracking-wide mb-1 block">Pods</span>
            <span class="text-lg font-semibold block">
              {{ node.resources.podsRunning ?? '—' }} / {{ node.resources.podsCapacity }}
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
                v-if="condition.reason"
                class="text-xs text-muted"
              >({{ condition.reason }})</span>
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
              name="i-lucide-tag"
              class="size-4 text-muted"
            />
            <span class="text-sm font-medium">Labels</span>
            <UBadge
              :label="String(labelEntries.length)"
              color="neutral"
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
            variant="outline"
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
              :label="String(node.taints.length)"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
        </USeparator>

        <div class="rounded-lg border border-default divide-y divide-default">
          <div
            v-for="(taint, idx) in node.taints"
            :key="idx"
            class="flex items-center justify-between px-3 py-2"
          >
            <span class="text-sm font-mono">
              {{ taint.key }}{{ taint.value ? `=${taint.value}` : '' }}
            </span>
            <UBadge
              :label="taint.effect"
              color="warning"
              variant="subtle"
              size="xs"
            />
          </div>
        </div>
      </template>

      <!-- Join command (for pending workers) -->
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
          color="info"
          variant="soft"
          icon="i-lucide-info"
          title="Run this on your worker server"
        >
          <template #description>
            <p class="text-sm mb-2">
              SSH into your server and execute the command below to join this node to the cluster.
            </p>
          </template>
        </UAlert>

        <div class="relative">
          <pre class="bg-elevated rounded-lg p-4 text-sm font-mono overflow-x-auto whitespace-pre-wrap break-all border border-default">{{ node.joinCommand }}</pre>
          <UButton
            :icon="copied ? 'i-lucide-check' : 'i-lucide-copy'"
            :color="copied ? 'success' : 'neutral'"
            variant="ghost"
            size="xs"
            class="absolute top-2 right-2"
            @click="copyJoinCommand"
          >
            {{ copied ? 'Copied!' : 'Copy' }}
          </UButton>
        </div>
      </template>

      <!-- Timestamps -->
      <USeparator>
        <div class="flex items-center gap-2 px-2">
          <UIcon
            name="i-lucide-clock"
            class="size-4 text-muted"
          />
          <span class="text-sm font-medium">Timestamps</span>
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

      <!-- Status message -->
      <UAlert
        v-if="node.statusMessage"
        color="warning"
        variant="soft"
        icon="i-lucide-alert-triangle"
        :description="node.statusMessage"
      />

      <!-- Error message -->
      <UAlert
        v-if="message"
        color="error"
        variant="subtle"
        icon="i-lucide-circle-alert"
        :description="message"
      />

      <!-- Footer -->
      <div class="flex justify-end gap-2 pt-2 border-t border-default">
        <UButton
          color="neutral"
          variant="outline"
          label="Close"
          @click="emit('close')"
        />

        <UDropdownMenu
          :items="[
            [{ label: 'Edit', icon: 'i-lucide-edit', onSelect: () => emit('edit') }],
            [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => emit('delete') }]
          ]"
        >
          <UButton
            color="neutral"
            label="More actions"
            trailing-icon="i-lucide-chevron-down"
          />
        </UDropdownMenu>
      </div>
    </template>

    <!-- ══════════════════════════════════════════════════════════════════════
         EDIT MODE: Limited editing (name only)
         ══════════════════════════════════════════════════════════════════════ -->
    <template v-if="mode === 'edit'">
      <UForm
        :schema="editSchema"
        :state="editFormState"
        class="space-y-4"
        @submit="onEditSubmit"
      >
        <UFormField
          label="Name"
          name="name"
          required
        >
          <UInput
            v-model="node.name"
            placeholder="worker-1"
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
          variant="subtle"
          icon="i-lucide-circle-alert"
          :description="message"
        />

        <!-- Footer -->
        <div class="flex justify-end gap-2 pt-2 border-t border-default">
          <UButton
            color="neutral"
            variant="outline"
            label="Cancel"
            :disabled="loading"
            @click="emit('close')"
          />
          <UButton
            type="submit"
            :label="submitLabel"
            :loading="loading"
          />
        </div>
      </UForm>
    </template>
  </div>
</template>
