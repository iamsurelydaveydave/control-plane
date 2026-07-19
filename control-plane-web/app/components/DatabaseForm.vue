<script setup lang="ts">
/**
 * DatabaseForm — Form component for Database resource following goweekdays-web pattern.
 *
 * Supports three modes: 'add', 'edit', and 'view'.
 * Uses defineModel() for two-way binding of the resource object and error message.
 * Never calls API functions — only emits events (submit, close, edit, delete, viewCredentials, reprovision).
 */
const props = withDefaults(
  defineProps<{
    title?: string
    mode?: 'add' | 'edit' | 'view'
    loading?: boolean
    servers?: TServer[]
  }>(),
  {
    title: 'Database',
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
  viewCredentials: []
  reprovision: []
}>()

const message = defineModel<string>('message', { default: '' })
const database = defineModel<TDatabase & { serverId?: string, adminUser?: string, adminPassword?: string }>('database', {
  default: () => ({
    _id: '',
    name: '',
    type: 'mongodb',
    version: '7.0',
    status: 'unknown',
    serverId: '',
    adminUser: 'admin',
    adminPassword: ''
  })
})

const isMutable = computed(() => ['add', 'edit'].includes(props.mode))

const submitLabel = computed(() => {
  switch (props.mode) {
    case 'add': return 'Create Database'
    case 'edit': return 'Save changes'
    default: return ''
  }
})

const serverItems = computed(() =>
  props.servers.map(s => ({ value: s._id, label: `${s.name} (${s.host})` }))
)

// Generate random password
function generatePassword() {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*'
  let password = ''
  for (let i = 0; i < 24; i++) {
    password += chars[Math.floor(Math.random() * chars.length)]
  }
  database.value.adminPassword = password
}
</script>

<template>
  <div class="p-6 space-y-4">
    <div class="space-y-4">
      <UFormField
        label="Name"
        required
      >
        <UInput
          v-model="database.name"
          placeholder="my-database"
          :disabled="!isMutable"
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
          />
        </UFormField>

        <UFormField label="Version">
          <UInput
            v-model="database.version"
            placeholder="7.0"
            :disabled="!isMutable"
          />
        </UFormField>
      </div>

      <UFormField
        v-if="mode === 'add'"
        label="Server"
        required
      >
        <USelect
          v-model="database.serverId"
          :items="serverItems"
          placeholder="Select a server"
          :disabled="!serverItems.length"
        />
        <template #hint>
          <span
            v-if="serverItems.length"
            class="text-xs text-muted"
          >
            The server where the database will be deployed.
          </span>
          <span
            v-else
            class="text-xs text-error"
          >
            No ready servers. Servers must be <span class="font-medium">online with Docker installed</span>.
            <NuxtLink
              to="/dashboard/servers"
              class="underline font-medium"
            >Set up a server</NuxtLink> first.
          </span>
        </template>
      </UFormField>

      <UAlert
        v-if="mode === 'add' && !serverItems.length"
        color="warning"
        variant="soft"
        icon="i-lucide-server"
        title="No ready servers"
      >
        <template #description>
          <p>
            Servers must be <span class="font-medium">online with Docker installed</span> before a database can be provisioned.
            <NuxtLink
              to="/dashboard/servers"
              class="underline font-medium"
            >Set up a server</NuxtLink> first.
          </p>
        </template>
      </UAlert>

      <template v-if="mode === 'add'">
        <USeparator label="Authentication" />

        <div class="grid grid-cols-2 gap-4">
          <UFormField label="Admin User">
            <UInput
              v-model="database.adminUser"
              placeholder="admin"
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
                title="Generate password"
                @click="generatePassword"
              />
            </div>
          </UFormField>
        </div>
      </template>

      <UFormField
        v-if="mode === 'view'"
        label="Status"
      >
        <div class="flex items-center gap-2">
          <UBadge
            :color="database.status === 'running' ? 'success' : database.status === 'provisioning' ? 'warning' : database.status === 'failed' ? 'error' : 'neutral'"
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
            { label: 'View Credentials', icon: 'i-lucide-key', onSelect: () => emit('viewCredentials'), disabled: database.status !== 'running' },
            { label: 'Reprovision', icon: 'i-lucide-refresh-cw', onSelect: () => emit('reprovision') }
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
        :disabled="mode === 'add' && (!database.serverId || !serverItems.length || !database.name || !database.adminPassword)"
        @click="emit('submit')"
      />
    </div>
  </div>
</template>
