<script setup lang="ts">
/**
 * Servers page — manage server infrastructure.
 * Follows goweekdays-web pattern from apps/deploy/pages/[org]/nodes/index.vue
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getAll, add, deleteById } = useServer()
const { getAll: getAllSSHKeys } = useSSHKey()

// Fetch SSH keys for the dropdown
const { data: sshKeysData } = useLazyAsyncData(
  'ssh-keys-dropdown',
  () => getAllSSHKeys().catch(() => ({ items: [] }))
)
const sshKeyOptions = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.map(k => ({ value: k._id, label: k.name + (k.isDefault ? ' (default)' : '') }))
})
const defaultSSHKey = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.find(k => k.isDefault)
})
const selectedSSHKey = computed(() => {
  const keys = sshKeysData.value?.items ?? []
  return keys.find(k => k._id === form.sshKeyId)
})

// Helper to get SSH key name by ID for server list display
function getSSHKeyName(sshKeyId?: string) {
  if (!sshKeyId) return null
  const keys = sshKeysData.value?.items ?? []
  const key = keys.find(k => k._id === sshKeyId)
  return key?.name ?? null
}

// Data fetching
const { data: servers, refresh, status } = useLazyAsyncData(
  'servers',
  () => getAll({ page: 1 }).catch(() => ({ items: [], pages: 0 }))
)
const loading = computed(() => status.value === 'pending')
const items = computed(() => servers.value?.items ?? [])

const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  online: 'success',
  offline: 'error',
  provisioning: 'warning',
  unknown: 'neutral'
}

// Add dialog
const addOpen = ref(false)
const adding = ref(false)
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
  addOpen.value = true
}

async function submitAdd() {
  if (!form.name || !form.host || adding.value) return
  adding.value = true
  try {
    const payload: TServerForm = {
      name: form.name,
      host: form.host,
      sshUser: form.sshUser,
      sshPort: form.sshPort,
      sshKeyId: form.sshKeyId || undefined
    }
    await add(payload)
    toast.add({
      title: `${form.name} added successfully`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    addOpen.value = false
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to add server',
      color: 'error'
    })
  } finally {
    adding.value = false
  }
}

// Delete dialog
const deleteOpen = ref(false)
const deleting = ref(false)
const deleteTarget = ref<TServer | null>(null)

function openDelete(server: TServer) {
  deleteTarget.value = server
  deleteOpen.value = true
}

async function submitDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await deleteById(deleteTarget.value._id)
    toast.add({
      title: `${deleteTarget.value.name} deleted`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    deleteOpen.value = false
    deleteTarget.value = null
    await refresh()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: err?.data?.message || 'Failed to delete server',
      color: 'error'
    })
  } finally {
    deleting.value = false
  }
}

useHead({ title: 'Servers · Control Plane' })
</script>

<template>
  <div class="space-y-4">
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

    <!-- Loading state -->
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
      <div
        v-for="server in items"
        :key="server._id"
        class="flex items-center justify-between rounded-xl border border-default bg-elevated/50 px-4 py-3.5 hover:bg-elevated transition-colors group"
      >
        <div class="flex items-center gap-3">
          <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
            <UIcon
              name="i-lucide-server"
              class="size-4 text-muted"
            />
          </div>
          <div>
            <div class="flex items-center gap-2">
              <span class="font-medium text-highlighted">
                {{ server.name }}
              </span>
              <UBadge
                :color="statusColor[server.status] || 'neutral'"
                variant="soft"
                size="xs"
              >
                {{ server.status }}
              </UBadge>
            </div>
            <p class="text-xs text-muted mt-0.5">
              {{ server.host }}
              <template v-if="server.sshUser">
                · {{ server.sshUser }}@{{ server.sshPort || 22 }}
              </template>
              <template v-if="getSSHKeyName(server.sshKeyId)">
                · <UIcon
                  name="i-lucide-key"
                  class="inline-block size-3"
                /> {{ getSSHKeyName(server.sshKeyId) }}
              </template>
            </p>
          </div>
        </div>

        <UDropdownMenu
          :items="[
            [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => openDelete(server) }]
          ]"
        >
          <UButton
            icon="i-lucide-ellipsis"
            color="neutral"
            variant="ghost"
            size="sm"
          />
        </UDropdownMenu>
      </div>
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
                  No SSH keys available. <NuxtLink
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

          <!-- SSH key copy instructions -->
          <UAlert
            v-if="selectedSSHKey"
            color="warning"
            variant="soft"
            icon="i-lucide-key"
            title="Copy SSH key to server"
          >
            <template #description>
              <p class="mb-2">
                Run this command to authorize the selected key on your server:
              </p>
              <code class="block text-xs font-mono break-all bg-warning/10 p-2 rounded">
                ssh {{ form.sshUser || 'root' }}@{{ form.host || 'YOUR_SERVER_IP' }} "mkdir -p ~/.ssh && echo '{{ selectedSSHKey.publicKey }}' >> ~/.ssh/authorized_keys"
              </code>
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
              <p>
                You need to create an SSH key before adding a server.
                <NuxtLink
                  to="/dashboard/settings/ssh-keys"
                  class="underline font-medium"
                >Go to SSH Keys</NuxtLink>
              </p>
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
          icon="i-lucide-plus"
          @click="submitAdd"
        >
          Add Server
        </UButton>
      </template>
    </UModal>

    <!-- Delete confirmation modal -->
    <UModal
      v-model:open="deleteOpen"
      title="Delete Server"
    >
      <template #body>
        <div class="flex items-start gap-4">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-full bg-error/10">
            <UIcon
              name="i-lucide-alert-triangle"
              class="size-5 text-error"
            />
          </div>
          <div>
            <p class="text-muted">
              Are you sure you want to delete
              <span class="font-medium text-highlighted">{{ deleteTarget?.name }}</span>?
              This action cannot be undone.
            </p>
          </div>
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
          icon="i-lucide-trash"
          @click="submitDelete"
        >
          Delete Server
        </UButton>
      </template>
    </UModal>
  </div>
</template>
