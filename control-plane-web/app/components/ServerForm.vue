<script setup lang="ts">
/**
 * ServerForm — Form component for Server resource following goweekdays-web pattern.
 *
 * Supports three modes: 'add', 'edit', and 'view'.
 * Uses defineModel() for two-way binding of the resource object and error message.
 * Never calls API functions — only emits events (submit, close, edit, delete).
 */
const props = withDefaults(
  defineProps<{
    title?: string
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
  }>(),
  {
    title: 'Server',
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
const server = defineModel<TServer>('server', {
  default: () => ({
    _id: '',
    name: '',
    host: '',
    status: 'unknown',
    provider: '',
    sshUser: 'root',
    sshPort: 22
  })
})

const isMutable = computed(() => ['add', 'edit'].includes(props.mode))

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'add': return 'Add Server'
    case 'edit': return 'Save changes'
    default: return ''
  }
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
          v-model="server.name"
          placeholder="my-server"
          :disabled="!isMutable"
        />
      </UFormField>

      <UFormField
        label="Host"
        hint="IP address or hostname"
        required
      >
        <UInput
          v-model="server.host"
          placeholder="192.168.1.100"
          :disabled="!isMutable"
        />
      </UFormField>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="SSH User">
          <UInput
            v-model="server.sshUser"
            placeholder="root"
            :disabled="!isMutable"
          />
        </UFormField>

        <UFormField label="SSH Port">
          <UInput
            v-model.number="server.sshPort"
            type="number"
            placeholder="22"
            :disabled="!isMutable"
          />
        </UFormField>
      </div>

      <UFormField
        v-if="mode === 'view'"
        label="Status"
      >
        <UBadge
          :color="server.status === 'online' ? 'success' : server.status === 'offline' ? 'error' : 'neutral'"
          :label="server.status"
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
          [{ label: 'Edit', icon: 'i-lucide-edit', onSelect: () => emit('edit') }],
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
        @click="emit('submit')"
      />
    </div>
  </div>
</template>
