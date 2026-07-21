<script setup lang="ts">
import { z } from 'zod'
import type { FormSubmitEvent } from '#ui/types'

/**
 * NodeProvisionForm — Form for provisioning a new worker node.
 *
 * Collects VM details (host, SSH credentials) and provisions the node.
 * Shows provisioning progress with step-by-step status.
 */
const props = withDefaults(
  defineProps<{
    clusterId: string
    loading?: boolean
    sshKeys?: Array<{ _id: string; name: string }>
  }>(),
  {
    loading: false,
    sshKeys: () => []
  }
)

const emit = defineEmits<{
  close: []
  submit: [data: TNodeProvisionInput]
  testConnection: [data: { host: string; sshPort: number; sshUser: string; sshKeyId: string }]
}>()

const message = defineModel<string>('message', { default: '' })

// Form state
const form = ref({
  name: '',
  host: '',
  sshUser: 'root',
  sshPort: 22,
  sshKeyId: ''
})

// Connection test state
const testingConnection = ref(false)
const connectionTestResult = ref<{ success: boolean; error?: string; serverInfo?: { os: string; hostname: string } } | null>(null)

// Zod schema for validation
const schema = z.object({
  name: z.string()
    .min(1, 'Node name is required')
    .max(63, 'Node name must be at most 63 characters')
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$/, 'Node name must be lowercase alphanumeric with hyphens'),
  host: z.string()
    .min(1, 'Host is required')
    .regex(/^[a-zA-Z0-9.-]+$/, 'Invalid host format'),
  sshUser: z.string().min(1, 'SSH user is required'),
  sshPort: z.number().int().min(1).max(65535),
  sshKeyId: z.string().min(1, 'SSH key is required')
})

type FormState = z.infer<typeof schema>

// SSH key options for select
const sshKeyOptions = computed(() =>
  props.sshKeys.map(k => ({ label: k.name, value: k._id }))
)

// Can submit?
const canSubmit = computed(() => {
  return form.value.name && form.value.host && form.value.sshKeyId && !props.loading
})

// Test connection before submitting
async function handleTestConnection() {
  if (!form.value.host || !form.value.sshKeyId) return

  testingConnection.value = true
  connectionTestResult.value = null
  message.value = ''

  emit('testConnection', {
    host: form.value.host,
    sshPort: form.value.sshPort,
    sshUser: form.value.sshUser,
    sshKeyId: form.value.sshKeyId
  })
}

// Called by parent when test connection completes
function setTestResult(result: { success: boolean; error?: string; serverInfo?: { os: string; hostname: string } }) {
  testingConnection.value = false
  connectionTestResult.value = result
}

// Handle form submission
function onSubmit(event: FormSubmitEvent<FormState>) {
  message.value = ''
  emit('submit', {
    clusterId: props.clusterId,
    name: event.data.name,
    host: event.data.host,
    sshUser: event.data.sshUser,
    sshPort: event.data.sshPort,
    sshKeyId: event.data.sshKeyId
  })
}

// Expose for parent to call
defineExpose({ setTestResult })
</script>

<template>
  <div class="space-y-4 p-4">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <div class="flex size-10 items-center justify-center rounded-lg bg-primary/10">
        <UIcon name="i-lucide-plus" class="size-5 text-primary" />
      </div>
      <div>
        <h3 class="font-semibold text-highlighted">
          Add Worker Node
        </h3>
        <p class="text-sm text-muted">
          Enter VM details to provision a new worker node.
        </p>
      </div>
    </div>

    <UForm
      :schema="schema"
      :state="form"
      class="space-y-4"
      @submit="onSubmit"
    >
      <!-- Node Name -->
      <UFormField label="Node Name" name="name" required>
        <UInput
          v-model="form.name"
          placeholder="worker-1"
          icon="i-lucide-tag"
        />
      </UFormField>

      <!-- Host / IP -->
      <UFormField label="Host / IP Address" name="host" required>
        <UInput
          v-model="form.host"
          placeholder="192.168.1.100"
          icon="i-lucide-server"
        />
      </UFormField>

      <!-- SSH Configuration -->
      <div class="grid grid-cols-2 gap-4">
        <UFormField label="SSH User" name="sshUser">
          <UInput
            v-model="form.sshUser"
            placeholder="root"
            icon="i-lucide-user"
          />
        </UFormField>

        <UFormField label="SSH Port" name="sshPort">
          <UInput
            v-model.number="form.sshPort"
            type="number"
            placeholder="22"
            icon="i-lucide-hash"
          />
        </UFormField>
      </div>

      <!-- SSH Key -->
      <UFormField label="SSH Key" name="sshKeyId" required>
        <USelect
          v-model="form.sshKeyId"
          :items="sshKeyOptions"
          placeholder="Select SSH key..."
          icon="i-lucide-key"
          value-key="value"
        />
        <template #hint>
          <span class="text-xs text-muted">
            The private key will be used to connect to the VM.
            <NuxtLink
              to="/dashboard/settings/secrets"
              class="text-primary hover:underline"
            >
              Manage SSH keys
            </NuxtLink>
          </span>
        </template>
      </UFormField>

      <!-- Test Connection Button -->
      <div class="flex items-center gap-4">
        <UButton
          type="button"
          variant="soft"
          color="neutral"
          icon="i-lucide-plug"
          label="Test Connection"
          :loading="testingConnection"
          :disabled="!form.host || !form.sshKeyId"
          @click="handleTestConnection"
        />

        <!-- Test Result -->
        <div v-if="connectionTestResult" class="flex-1">
          <UAlert
            v-if="connectionTestResult.success"
            color="success"
            variant="soft"
            icon="i-lucide-check-circle"
          >
            <template #title>
              Connection successful
            </template>
            <template #description>
              <span v-if="connectionTestResult.serverInfo">
                {{ connectionTestResult.serverInfo.hostname }} · {{ connectionTestResult.serverInfo.os }}
              </span>
            </template>
          </UAlert>
          <UAlert
            v-else
            color="error"
            variant="soft"
            icon="i-lucide-x-circle"
          >
            <template #title>
              Connection failed
            </template>
            <template #description>
              {{ connectionTestResult.error || 'Unable to connect' }}
            </template>
          </UAlert>
        </div>
      </div>

      <!-- Info about what happens -->
      <UAlert
        title="What happens next?"
        icon="i-lucide-info"
        color="info"
        variant="subtle"
      >
        <template #description>
          <ol class="list-decimal list-inside text-sm space-y-1 mt-2">
            <li>Control Plane will SSH to your VM</li>
            <li>Install k3s agent to join the cluster</li>
            <li>The node will appear in the list once ready</li>
          </ol>
        </template>
      </UAlert>

      <!-- Error message -->
      <UAlert
        v-if="message"
        :description="message"
        color="error"
        variant="soft"
        icon="i-lucide-alert-circle"
      />

      <!-- Footer -->
      <div class="flex justify-end gap-2 pt-4 border-t border-default">
        <UButton
          variant="ghost"
          label="Cancel"
          @click="emit('close')"
        />
        <UButton
          type="submit"
          label="Provision Node"
          icon="i-lucide-rocket"
          :loading="loading"
          :disabled="!canSubmit"
        />
      </div>
    </UForm>
  </div>
</template>
