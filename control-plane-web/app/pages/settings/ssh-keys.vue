<template>
  <div class="flex justify-center p-1">
    <div class="w-full max-w-4xl">
      <!-- Header -->
      <div class="mb-6">
        <div class="flex items-center gap-2 mb-1">
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            size="sm"
            to="/settings"
          />
          <h1 class="text-xl font-bold text-highlighted">
            SSH Keys
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Manage SSH keys for secure server connections.
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">
          {{ sshKeysList.length }} key{{ sshKeysList.length === 1 ? '' : 's' }}
        </p>
        <div class="flex gap-2">
          <UButton
            color="neutral"
            variant="soft"
            icon="i-lucide-upload"
            @click="setSSHKey({ mode: 'import' })"
          >
            Import Key
          </UButton>
          <UButton
            icon="i-lucide-plus"
            @click="setSSHKey({ mode: 'create' })"
          >
            Generate Key
          </UButton>
        </div>
      </div>

      <!-- Loading -->
      <div
        v-if="sshKeysLoading"
        class="space-y-2"
      >
        <USkeleton
          v-for="i in 2"
          :key="i"
          class="h-20 rounded-xl"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!sshKeysList.length"
        class="rounded-xl border border-default bg-elevated/50 p-12 text-center"
      >
        <UIcon
          name="i-lucide-key"
          class="mx-auto mb-3 size-10 text-muted"
        />
        <h3 class="font-medium text-highlighted">
          No SSH keys
        </h3>
        <p class="mt-1 text-sm text-muted mb-4">
          Generate an SSH key to connect to your servers.
        </p>
        <UButton
          variant="subtle"
          icon="i-lucide-plus"
          @click="setSSHKey({ mode: 'create' })"
        >
          Generate Key
        </UButton>
      </div>

      <!-- Keys list -->
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-for="key in sshKeysList"
          :key="key._id"
          class="rounded-xl border border-default bg-elevated/50 p-4"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
                <UIcon
                  name="i-lucide-key"
                  class="size-5 text-muted"
                />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-highlighted">{{ key.name }}</span>
                  <UBadge
                    v-if="key.isDefault"
                    color="primary"
                    variant="soft"
                    size="xs"
                  >
                    Default
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="xs"
                  >
                    {{ key.type.toUpperCase() }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted mt-1 font-mono">
                  {{ key.fingerprint }}
                </p>
                <p class="text-xs text-muted mt-0.5">
                  Created {{ formatDate(key.createdAt) }}
                </p>
              </div>
            </div>

            <UDropdownMenu
              :items="[
                [
                  { label: 'Copy public key', icon: 'i-lucide-copy', onSelect: () => copyPublicKey(key) },
                  ...(key.isDefault ? [] : [{ label: 'Set as default', icon: 'i-lucide-star', onSelect: () => setDefaultKey(key) }])
                ],
                [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => openDeleteSSHKey(key) }]
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

          <div class="mt-3 p-2 bg-muted/50 rounded-lg">
            <code class="text-xs font-mono break-all text-muted">{{ key.publicKey }}</code>
          </div>
        </div>
      </div>
    </div>

    <!-- SSH Key Modal (Create / Import) -->
    <UModal
      v-model:open="sshKeyDialog"
      :title="createdPrivateKey
        ? 'Save Your Private Key'
        : sshKeyMode === 'import'
          ? 'Import SSH Key'
          : 'Generate SSH Key'"
    >
      <template #body>
        <!-- Created: show private key download -->
        <div
          v-if="createdPrivateKey"
          class="space-y-4"
        >
          <UAlert
            color="warning"
            icon="i-lucide-alert-triangle"
            title="Save this key now"
            description="The private key cannot be retrieved later. Download or copy it before closing."
          />
          <div class="p-3 bg-muted/50 rounded-lg max-h-40 overflow-auto">
            <code class="text-xs font-mono break-all whitespace-pre-wrap">{{ createdPrivateKey }}</code>
          </div>
          <div class="flex gap-2">
            <UButton
              variant="soft"
              icon="i-lucide-download"
              class="flex-1"
              @click="downloadPrivateKey"
            >
              Download Key
            </UButton>
            <UButton
              variant="soft"
              icon="i-lucide-copy"
              color="neutral"
              class="flex-1"
              @click="copyPrivateKey"
            >
              Copy to Clipboard
            </UButton>
          </div>
        </div>

        <!-- Create / Import form -->
        <div
          v-else
          class="space-y-4"
        >
          <UFormField label="Key name">
            <UInput
              v-model="sshKeyForm.name"
              :placeholder="sshKeyMode === 'import' ? 'my-imported-key' : 'my-key'"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="sshKeyMode === 'create'"
            label="Key type"
          >
            <USelect
              v-model="sshKeyForm.type"
              :items="[
                { value: 'ed25519', label: 'ED25519 (recommended)' },
                { value: 'rsa', label: 'RSA 4096' }
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField
            v-if="sshKeyMode === 'import'"
            label="Private key"
          >
            <UTextarea
              v-model="sshKeyForm.privateKey"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY-----
...
-----END OPENSSH PRIVATE KEY-----"
              :rows="8"
              class="w-full font-mono text-xs"
            />
            <template #hint>
              <span class="text-xs text-muted">Paste your private key. The public key will be extracted automatically.</span>
            </template>
          </UFormField>

          <UAlert
            v-if="sshKeyMessage"
            color="error"
            variant="soft"
            :title="sshKeyMessage"
          />
        </div>
      </template>

      <template #footer>
        <template v-if="createdPrivateKey">
          <UButton
            icon="i-lucide-check"
            @click="setSSHKey({ dialog: false })"
          >
            I've Saved the Key
          </UButton>
        </template>
        <template v-else>
          <UButton
            color="neutral"
            variant="ghost"
            @click="setSSHKey({ dialog: false })"
          >
            Cancel
          </UButton>
          <UButton
            :loading="sshKeyLoading"
            :disabled="sshKeyMode === 'import' ? !sshKeyForm.name || !sshKeyForm.privateKey : !sshKeyForm.name"
            :icon="sshKeyMode === 'import' ? 'i-lucide-upload' : 'i-lucide-key'"
            @click="submitSSHKey"
          >
            {{ sshKeyMode === 'import' ? 'Import' : 'Generate' }}
          </UButton>
        </template>
      </template>
    </UModal>

    <!-- SSH Key Delete Confirmation -->
    <ConfirmDialog
      v-model:open="sshKeyDeleteDialog"
      v-model:message="sshKeyMessage"
      title="Delete SSH Key"
      :content="`Are you sure you want to delete '${sshKeyTarget?.name}'? Servers using this key will no longer be accessible.`"
      confirm-label="Delete"
      color="error"
      :loading="sshKeyLoading"
      @confirm="submitDeleteSSHKey"
    />
  </div>
</template>

<script setup lang="ts">
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()

type TSSHKeyPublic = {
  _id: string
  name: string
  publicKey: string
  fingerprint: string
  type: 'ed25519' | 'rsa'
  isDefault: boolean
  createdAt: string
}

const { data: sshKeys, refresh: refreshSSHKeys, status: sshKeysStatus } = useLazyAsyncData(
  'ssh-keys',
  () => useNuxtApp().$api<{ items: TSSHKeyPublic[] }>('/ssh-keys').catch(() => ({ items: [] })),
  { server: false }
)
const sshKeysLoading = computed(() => sshKeysStatus.value === 'pending')
const sshKeysList = computed(() => sshKeys.value?.items ?? [])

// Dialog state
const sshKeyDialog = ref(false)
const sshKeyMode = ref<'create' | 'import'>('create')
const sshKeyDeleteDialog = ref(false)
const sshKeyLoading = ref(false)
const sshKeyMessage = ref('')
const sshKeyTarget = ref<TSSHKeyPublic | null>(null)
const createdPrivateKey = ref<string | null>(null)

const sshKeyForm = reactive({
  name: '',
  type: 'ed25519' as 'ed25519' | 'rsa',
  privateKey: ''
})

function setSSHKey(opts: {
  mode?: 'create' | 'import'
  dialog?: boolean
} = {}) {
  const { mode = 'create', dialog = true } = opts
  sshKeyMode.value = mode
  sshKeyDialog.value = dialog
  sshKeyMessage.value = ''
  createdPrivateKey.value = null
  sshKeyForm.name = ''
  sshKeyForm.type = 'ed25519'
  sshKeyForm.privateKey = ''
}

function openDeleteSSHKey(key: TSSHKeyPublic) {
  sshKeyTarget.value = key
  sshKeyMessage.value = ''
  sshKeyDeleteDialog.value = true
}

async function submitSSHKey() {
  if (sshKeyLoading.value) return

  if (sshKeyMode.value === 'create') {
    if (!sshKeyForm.name) return
    sshKeyLoading.value = true
    try {
      const result = await useNuxtApp().$api<{ privateKey: string, name: string }>('/ssh-keys', {
        method: 'POST',
        body: {
          name: sshKeyForm.name,
          type: sshKeyForm.type,
          isDefault: sshKeysList.value.length === 0
        }
      })
      createdPrivateKey.value = result.privateKey
      await refreshSSHKeys()
    } catch (e: unknown) {
      const err = e as { data?: { message?: string } }
      sshKeyMessage.value = err?.data?.message || 'Failed to create SSH key'
    } finally {
      sshKeyLoading.value = false
    }
  } else if (sshKeyMode.value === 'import') {
    if (!sshKeyForm.name || !sshKeyForm.privateKey) return
    sshKeyLoading.value = true
    try {
      await useNuxtApp().$api('/ssh-keys/import', {
        method: 'POST',
        body: {
          name: sshKeyForm.name,
          privateKey: sshKeyForm.privateKey,
          isDefault: sshKeysList.value.length === 0
        }
      })
      toast.add({ title: 'SSH key imported', color: 'success', icon: 'i-lucide-check' })
      setSSHKey({ dialog: false })
      await refreshSSHKeys()
    } catch (e: unknown) {
      const err = e as { data?: { message?: string } }
      sshKeyMessage.value = err?.data?.message || 'Failed to import SSH key'
    } finally {
      sshKeyLoading.value = false
    }
  }
}

async function submitDeleteSSHKey() {
  if (!sshKeyTarget.value || sshKeyLoading.value) return
  sshKeyLoading.value = true
  try {
    await useNuxtApp().$api(`/ssh-keys/${sshKeyTarget.value._id}`, { method: 'DELETE' })
    toast.add({ title: 'SSH key deleted', color: 'success', icon: 'i-lucide-check' })
    sshKeyDeleteDialog.value = false
    sshKeyTarget.value = null
    await refreshSSHKeys()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    sshKeyMessage.value = err?.data?.message || 'Failed to delete SSH key'
  } finally {
    sshKeyLoading.value = false
  }
}

function downloadPrivateKey() {
  if (!createdPrivateKey.value) return
  const blob = new Blob([createdPrivateKey.value], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = sshKeyForm.name || 'id_ed25519'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  toast.add({ title: 'Private key downloaded', color: 'success', icon: 'i-lucide-download' })
}

function copyPrivateKey() {
  if (createdPrivateKey.value) {
    navigator.clipboard.writeText(createdPrivateKey.value)
    toast.add({ title: 'Private key copied', color: 'success', icon: 'i-lucide-copy' })
  }
}

function copyPublicKey(key: TSSHKeyPublic) {
  navigator.clipboard.writeText(key.publicKey)
  toast.add({ title: 'Public key copied', color: 'success', icon: 'i-lucide-copy' })
}

async function setDefaultKey(key: TSSHKeyPublic) {
  try {
    await useNuxtApp().$api(`/ssh-keys/${key._id}/default`, { method: 'POST' })
    toast.add({ title: `${key.name} set as default`, color: 'success', icon: 'i-lucide-check' })
    await refreshSSHKeys()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to set default', color: 'error' })
  }
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

useHead({ title: 'SSH Keys · Settings · Control Plane' })
</script>
