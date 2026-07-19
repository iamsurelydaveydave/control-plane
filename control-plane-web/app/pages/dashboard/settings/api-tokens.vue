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
            to="/dashboard/settings"
          />
          <h1 class="text-xl font-bold text-highlighted">
            API Tokens
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Manage API tokens for programmatic access.
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">
          {{ apiTokensList.length }} token{{ apiTokensList.length === 1 ? '' : 's' }}
        </p>
        <UButton
          icon="i-lucide-plus"
          @click="setToken()"
        >
          Create Token
        </UButton>
      </div>

      <!-- Loading -->
      <div
        v-if="apiTokensLoading"
        class="space-y-2"
      >
        <USkeleton
          v-for="i in 2"
          :key="i"
          class="h-16 rounded-xl"
        />
      </div>

      <!-- Empty state -->
      <div
        v-else-if="!apiTokensList.length"
        class="rounded-xl border border-default bg-elevated/50 p-12 text-center"
      >
        <UIcon
          name="i-lucide-code"
          class="mx-auto mb-3 size-10 text-muted"
        />
        <h3 class="font-medium text-highlighted">
          No API tokens
        </h3>
        <p class="mt-1 text-sm text-muted mb-4">
          Create an API token for programmatic access.
        </p>
        <UButton
          variant="subtle"
          icon="i-lucide-plus"
          @click="setToken()"
        >
          Create Token
        </UButton>
      </div>

      <!-- Tokens list -->
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-for="token in apiTokensList"
          :key="token._id"
          class="flex items-center justify-between rounded-xl border border-default bg-elevated/50 px-4 py-3.5"
        >
          <div class="flex items-center gap-3">
            <div class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
              <UIcon
                name="i-lucide-code"
                class="size-4 text-muted"
              />
            </div>
            <div>
              <div class="flex items-center gap-2">
                <span class="font-medium text-highlighted">{{ token.name }}</span>
                <code class="text-xs text-muted font-mono">{{ token.tokenPrefix }}...</code>
                <UBadge
                  :color="token.scopes.includes('*') ? 'primary' : 'neutral'"
                  variant="soft"
                  size="xs"
                >
                  {{ formatScopes(token.scopes) }}
                </UBadge>
              </div>
              <p class="text-xs text-muted mt-0.5">
                Created {{ formatDate(token.createdAt) }}
                <template v-if="token.lastUsedAt">
                  · Last used {{ formatDate(token.lastUsedAt) }}
                </template>
                <template v-if="token.expiresAt">
                  · Expires {{ formatDate(token.expiresAt) }}
                </template>
              </p>
            </div>
          </div>

          <UButton
            icon="i-lucide-trash"
            color="error"
            variant="ghost"
            size="sm"
            @click="openDeleteToken(token)"
          />
        </div>
      </div>
    </div>

    <!-- API Token Modal (Create) -->
    <UModal
      v-model:open="tokenDialog"
      :title="createdToken ? 'Token Created' : 'Create API Token'"
    >
      <template #body>
        <!-- Created: show token -->
        <div
          v-if="createdToken"
          class="space-y-4"
        >
          <UAlert
            color="warning"
            variant="soft"
            icon="i-lucide-alert-triangle"
            title="Save this token now"
            description="This token will only be shown once. Copy it and store it securely."
          />
          <div class="p-3 bg-muted/50 rounded-lg">
            <code class="text-sm font-mono break-all">{{ createdToken }}</code>
          </div>
          <UButton
            block
            icon="i-lucide-copy"
            @click="copyToken"
          >
            Copy Token
          </UButton>
        </div>

        <!-- Create form -->
        <div
          v-else
          class="space-y-4"
        >
          <UFormField label="Token name">
            <UInput
              v-model="tokenForm.name"
              placeholder="my-token"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Permissions">
            <USelect
              v-model="tokenForm.scopes"
              :items="availableScopes"
              value-key="value"
              label-key="label"
              multiple
              placeholder="Select scopes..."
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">Select "Full Access" for admin tokens, or choose specific permissions.</span>
            </template>
          </UFormField>

          <UFormField label="Expires in (days)">
            <UInput
              v-model.number="tokenForm.expiresInDays"
              type="number"
              :min="1"
              :max="365"
              class="w-full"
            />
          </UFormField>

          <UAlert
            v-if="tokenMessage"
            color="error"
            variant="soft"
            :title="tokenMessage"
          />
        </div>
      </template>

      <template #footer>
        <UButton
          v-if="createdToken"
          block
          @click="setToken({ dialog: false })"
        >
          Done
        </UButton>
        <template v-else>
          <UButton
            color="neutral"
            variant="ghost"
            @click="setToken({ dialog: false })"
          >
            Cancel
          </UButton>
          <UButton
            :loading="tokenLoading"
            :disabled="!tokenForm.name"
            icon="i-lucide-plus"
            @click="submitToken"
          >
            Create Token
          </UButton>
        </template>
      </template>
    </UModal>

    <!-- API Token Delete Confirmation -->
    <ConfirmDialog
      v-model:open="tokenDeleteDialog"
      v-model:message="tokenMessage"
      title="Delete API Token"
      :content="`Are you sure you want to delete '${tokenTarget?.name}'? Any applications using this token will lose access.`"
      confirm-label="Delete"
      color="error"
      :loading="tokenLoading"
      @confirm="submitDeleteToken"
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

type TAPIToken = {
  _id: string
  name: string
  tokenPrefix: string
  scopes: string[]
  expiresAt?: string
  lastUsedAt?: string
  createdAt: string
}

const availableScopes = [
  { value: '*', label: 'Full Access' },
  { value: 'servers:read', label: 'Servers (Read)' },
  { value: 'servers:write', label: 'Servers (Write)' },
  { value: 'apps:read', label: 'Apps (Read)' },
  { value: 'apps:write', label: 'Apps (Write)' },
  { value: 'databases:read', label: 'Databases (Read)' },
  { value: 'databases:write', label: 'Databases (Write)' },
  { value: 'deployments:read', label: 'Deployments (Read)' },
  { value: 'deployments:write', label: 'Deployments (Write)' }
]

const { data: apiTokens, refresh: refreshAPITokens, status: apiTokensStatus } = useLazyAsyncData(
  'api-tokens',
  () => useNuxtApp().$api<{ items: TAPIToken[] }>('/api-tokens').catch(() => ({ items: [] })),
  { server: false }
)
const apiTokensLoading = computed(() => apiTokensStatus.value === 'pending')
const apiTokensList = computed(() => apiTokens.value?.items ?? [])

// Dialog state
const tokenDialog = ref(false)
const tokenDeleteDialog = ref(false)
const tokenLoading = ref(false)
const tokenMessage = ref('')
const tokenTarget = ref<TAPIToken | null>(null)
const createdToken = ref<string | null>(null)

const tokenForm = reactive({
  name: '',
  expiresInDays: 90,
  scopes: ['*'] as string[]
})

function setToken(opts: { dialog?: boolean } = {}) {
  const { dialog = true } = opts
  tokenDialog.value = dialog
  tokenMessage.value = ''
  createdToken.value = null
  tokenForm.name = ''
  tokenForm.expiresInDays = 90
  tokenForm.scopes = ['*']
}

function openDeleteToken(token: TAPIToken) {
  tokenTarget.value = token
  tokenMessage.value = ''
  tokenDeleteDialog.value = true
}

function formatScopes(scopes: string[]): string {
  if (scopes.includes('*')) return 'Full Access'
  return scopes.map(s => s.split(':')[0]).filter((v, i, a) => a.indexOf(v) === i).join(', ')
}

async function submitToken() {
  if (tokenLoading.value || !tokenForm.name) return
  tokenLoading.value = true
  try {
    const result = await useNuxtApp().$api<{ token: string }>('/api-tokens', {
      method: 'POST',
      body: {
        name: tokenForm.name,
        expiresInDays: tokenForm.expiresInDays,
        scopes: tokenForm.scopes
      }
    })
    createdToken.value = result.token
    await refreshAPITokens()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    tokenMessage.value = err?.data?.message || 'Failed to create API token'
  } finally {
    tokenLoading.value = false
  }
}

async function submitDeleteToken() {
  if (!tokenTarget.value || tokenLoading.value) return
  tokenLoading.value = true
  try {
    await useNuxtApp().$api(`/api-tokens/${tokenTarget.value._id}`, { method: 'DELETE' })
    toast.add({ title: 'API token deleted', color: 'success', icon: 'i-lucide-check' })
    tokenDeleteDialog.value = false
    tokenTarget.value = null
    await refreshAPITokens()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    tokenMessage.value = err?.data?.message || 'Failed to delete API token'
  } finally {
    tokenLoading.value = false
  }
}

function copyToken() {
  if (createdToken.value) {
    navigator.clipboard.writeText(createdToken.value)
    toast.add({ title: 'Token copied', color: 'success', icon: 'i-lucide-copy' })
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

useHead({ title: 'API Tokens · Settings · Control Plane' })
</script>
