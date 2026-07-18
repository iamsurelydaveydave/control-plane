<script setup lang="ts">
/**
 * AppForm — Form component for App resource following goweekdays-web pattern.
 *
 * Supports three modes: 'add', 'edit', and 'view'.
 * Uses defineModel() for two-way binding of the resource object and error message.
 * Never calls API functions — only emits events (submit, close, edit, delete, deploy).
 */
const props = withDefaults(
  defineProps<{
    title?: string
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
    servers?: TServer[]
  }>(),
  {
    title: 'App',
    mode: 'add',
    loading: false,
    servers: () => []
  }
)

const emit = defineEmits<{
  close: []
  submit: []
  edit: []
  delete: []
  deploy: []
}>()

const message = defineModel<string>('message', { default: '' })
const app = defineModel<TApp & { serverIds?: string[] }>('app', {
  default: () => ({
    _id: '',
    name: '',
    image: '',
    status: 'unknown',
    desiredReplicas: 1,
    serverIds: []
  })
})

const isMutable = computed(() => ['add', 'edit'].includes(props.mode))

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'add': return 'Create App'
    case 'edit': return 'Save changes'
    default: return ''
  }
})

const serverItems = computed(() =>
  props.servers.map(s => ({ value: s._id, label: `${s.name} (${s.host})` }))
)

// Check if form is valid
const canSubmit = computed(() => {
  if (props.mode === 'add') {
    return app.value.name && app.value.image && app.value.serverIds?.length
  }
  return app.value.name && app.value.image
})
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="space-y-4">
      <UFormField
        label="Name"
        required
      >
        <UInput
          v-model="app.name"
          placeholder="my-app"
          :disabled="!isMutable"
        />
      </UFormField>

      <UFormField
        label="Docker Image"
        hint="e.g., nginx:latest"
        required
      >
        <UInput
          v-model="app.image"
          placeholder="nginx:latest"
          :disabled="!isMutable"
        />
      </UFormField>

      <UFormField label="Replicas">
        <UInput
          v-model.number="app.desiredReplicas"
          type="number"
          min="0"
          :disabled="!isMutable"
        />
      </UFormField>

      <UFormField
        v-if="isMutable"
        label="Servers"
        required
      >
        <USelectMenu
          v-model="app.serverIds"
          :items="serverItems"
          value-key="value"
          placeholder="Select servers to deploy to"
          multiple
          :disabled="!serverItems.length"
        />
        <template #hint>
          <span
            v-if="serverItems.length"
            class="text-xs text-muted"
          >
            Select one or more servers where the app will be deployed.
          </span>
          <span
            v-else
            class="text-xs text-error"
          >
            No servers available. <NuxtLink
              to="/dashboard/servers"
              class="underline font-medium"
            >Add a server</NuxtLink> first.
          </span>
        </template>
      </UFormField>

      <UAlert
        v-if="isMutable && !serverItems.length"
        color="error"
        variant="soft"
        icon="i-lucide-alert-triangle"
        title="No servers available"
      >
        <template #description>
          <p>
            You need to add a server before creating an app.
            <NuxtLink
              to="/dashboard/servers"
              class="underline font-medium"
            >Go to Servers</NuxtLink>
          </p>
        </template>
      </UAlert>

      <UFormField
        v-if="mode === 'view'"
        label="Status"
      >
        <UBadge
          :color="app.status === 'running' ? 'success' : app.status === 'deploying' ? 'warning' : app.status === 'failed' ? 'error' : 'neutral'"
          :label="app.status"
          variant="subtle"
        />
      </UFormField>
    </div>

    <UAlert
      v-if="message"
      color="error"
      variant="subtle"
      icon="i-lucide-circle-alert"
      :description="message"
    />

    <div class="flex justify-end gap-2 pt-2 border-t border-default">
      <UButton
        color="neutral"
        variant="outline"
        :label="isMutable ? 'Cancel' : 'Close'"
        :disabled="loading"
        @click="emit('close')"
      />

      <!-- View mode: More actions menu -->
      <UDropdownMenu
        v-if="mode === 'view'"
        :items="[
          [
            { label: 'Deploy', icon: 'i-lucide-rocket', onSelect: () => emit('deploy') },
            { label: 'Edit', icon: 'i-lucide-edit', onSelect: () => emit('edit') }
          ],
          [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error', onSelect: () => emit('delete') }]
        ]"
      >
        <UButton
          color="neutral"
          label="More actions"
          trailing-icon="i-lucide-chevron-down"
        />
      </UDropdownMenu>

      <!-- Add/Edit mode: Submit button -->
      <UButton
        v-if="isMutable"
        :label="submitLabel"
        :loading="loading"
        :disabled="!canSubmit"
        @click="emit('submit')"
      />
    </div>
  </div>
</template>
