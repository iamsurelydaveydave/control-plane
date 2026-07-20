<script setup lang="ts">
/**
 * DNS Settings — separate Cloudflare configuration for Apps and Databases.
 *
 * Apps DNS    → subdomains for deployed applications  (e.g. myapp.example.com)
 * Database DNS → SRV records for MongoDB replica sets (e.g. mongodb+srv://mydb.example.com)
 *
 * Both scopes share the same Cloudflare API token but can point at different
 * base domains (or the same domain with different subdomain patterns).
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getDNSConfig, verifyDNS, saveToken, saveDNSConfig, removeDNSConfig } = useSettings()

// ---------------------------------------------------------------------------
// Load current config
// ---------------------------------------------------------------------------
const { data: configData, refresh: refreshConfig } = await useLazyAsyncData(
  'dns-config',
  () => getDNSConfig().catch(() => ({
    provider: null,
    apiToken: undefined,
    apps: { configured: false, zoneId: undefined as string | undefined, baseDomain: undefined as string | undefined },
    db: { configured: false, zoneId: undefined as string | undefined, baseDomain: undefined as string | undefined }
  })),
  { server: false, immediate: true }
)
const config = computed(() => configData.value)

// ---------------------------------------------------------------------------
// Shared API token
// ---------------------------------------------------------------------------
const sharedToken = ref('')
const tokenSaving = ref(false)

// After saving, show the masked token length as the placeholder
const tokenPlaceholder = computed(() =>
  config.value?.apiToken
    ? '•'.repeat(config.value.apiToken.length)
    : 'Paste your Cloudflare API token'
)

async function handleSaveToken() {
  if (!sharedToken.value.trim()) {
    toast.add({ title: 'Enter an API token first', color: 'error' })
    return
  }
  tokenSaving.value = true
  try {
    await saveToken(sharedToken.value.trim())
    toast.add({ title: 'API token saved', color: 'success', icon: 'i-lucide-check' })
    sharedToken.value = ''
    await refreshConfig()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: 'Failed to save token', description: err?.data?.message, color: 'error' })
  } finally {
    tokenSaving.value = false
  }
}

// ---------------------------------------------------------------------------
// Per-scope form state
// ---------------------------------------------------------------------------
type ScopeState = {
  baseDomain: string
  saving: boolean
  removing: boolean
  confirmRemoveOpen: boolean
}

function makeScopeState(): ScopeState {
  return {
    baseDomain: '',
    saving: false,
    removing: false,
    confirmRemoveOpen: false
  }
}

const appsState = reactive(makeScopeState())
const dbState = reactive(makeScopeState())

function stateFor(scope: 'apps' | 'db') {
  return scope === 'apps' ? appsState : dbState
}

// ---------------------------------------------------------------------------
// Save (verifies + saves in one step)
// ---------------------------------------------------------------------------
async function handleSave(scope: 'apps' | 'db') {
  const s = stateFor(scope)

  if (!s.baseDomain.trim()) {
    toast.add({ title: 'Enter a base domain first', color: 'error' })
    return
  }

  const hasNewToken = !!sharedToken.value.trim()
  const hasSavedToken = !!config.value?.apiToken

  if (!hasNewToken && !hasSavedToken) {
    toast.add({ title: 'Save your API token first', color: 'error' })
    return
  }

  s.saving = true
  try {
    // If the user entered a new token, verify it and include it in the request.
    // If they didn't, omit apiToken — the backend will use the already-saved one.
    let zoneId: string | undefined

    if (hasNewToken) {
      const verify = await verifyDNS(sharedToken.value.trim(), s.baseDomain.trim())
      if (!verify.valid) {
        toast.add({
          title: 'Verification failed',
          description: verify.error || 'Check your token and domain',
          color: 'error'
        })
        return
      }
      zoneId = verify.zoneId
    }

    const result = await saveDNSConfig(scope, {
      baseDomain: s.baseDomain.trim(),
      ...(hasNewToken ? { apiToken: sharedToken.value.trim(), zoneId } : {})
    })
    toast.add({
      title: `${scope === 'apps' ? 'Apps' : 'Databases'} DNS saved`,
      description: `Zone: ${result.zoneName} · ${result.baseDomain}`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    s.baseDomain = ''
    await refreshConfig()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to save',
      description: err?.data?.message || 'Unknown error',
      color: 'error'
    })
  } finally {
    s.saving = false
  }
}

// ---------------------------------------------------------------------------
// Remove
// ---------------------------------------------------------------------------
async function handleRemove(scope: 'apps' | 'db') {
  const s = stateFor(scope)
  s.removing = true
  try {
    await removeDNSConfig(scope)
    toast.add({
      title: `${scope === 'apps' ? 'Apps' : 'Databases'} DNS removed`,
      color: 'success',
      icon: 'i-lucide-check'
    })
    s.confirmRemoveOpen = false
    await refreshConfig()
  } catch {
    toast.add({ title: 'Failed to remove', color: 'error' })
  } finally {
    s.removing = false
  }
}

useHead({ title: 'DNS Settings · Control Plane' })
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-6">
    <!-- Header -->
    <div class="flex items-center gap-3">
      <UButton
        icon="i-lucide-arrow-left"
        color="neutral"
        variant="ghost"
        to="/dashboard/settings"
      />
      <div>
        <h1 class="text-2xl font-bold text-highlighted">
          DNS Settings
        </h1>
        <p class="text-sm text-muted">
          Automate subdomain assignment for apps and
          <code>mongodb+srv://</code>
          URLs for replica sets.
        </p>
      </div>
    </div>

    <!-- Shared API token -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-4">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          Cloudflare API Token
        </h2>
        <p class="text-sm text-muted mt-0.5">
          Shared across both scopes. Needs
          <strong>Zone › DNS › Edit</strong> and
          <strong>Zone › Zone › Read</strong> permissions.
        </p>
      </div>

      <div class="flex items-center gap-3">
        <UInput
          v-model="sharedToken"
          type="password"
          :placeholder="tokenPlaceholder"
          class="flex-1 font-mono"
          autocomplete="off"
        />
        <UButton
          icon="i-lucide-save"
          :loading="tokenSaving"
          :disabled="!sharedToken"
          @click="handleSaveToken"
        >
          Save token
        </UButton>
      </div>
      <p class="text-sm text-muted">
        The token is shared across both Apps and Databases DNS scopes.
      </p>
    </div>

    <!-- Two scope cards -->
    <div class="space-y-6">
      <!-- Apps DNS -->
      <div class="rounded-xl border border-default bg-elevated/50 p-5 space-y-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-layout-grid"
                class="size-4 text-muted"
              />
              <h2 class="text-base font-semibold text-highlighted">
                Apps
              </h2>
              <UBadge
                v-if="config?.apps.configured"
                color="success"
                variant="subtle"
                size="xs"
                icon="i-lucide-shield-check"
                label="Verified"
              />
            </div>
            <p class="text-xs text-muted mt-0.5">
              Subdomains for deployed apps
            </p>
          </div>
          <UButton
            v-if="config?.apps.configured"
            icon="i-lucide-trash"
            color="error"
            variant="ghost"
            @click="appsState.confirmRemoveOpen = true"
          />
        </div>

        <!-- Active status -->
        <div
          v-if="config?.apps.configured"
          class="rounded-lg bg-success/10 border border-success/20 px-3 py-2 text-xs space-y-0.5"
        >
          <p class="font-medium text-success">
            {{ config?.apps?.baseDomain }}
          </p>
          <p class="text-muted font-mono">
            Zone: {{ config?.apps?.zoneId }}
          </p>
        </div>

        <!-- Form -->
        <UFormField label="Base Domain">
          <UInput
            v-model="appsState.baseDomain"
            placeholder="example.com"
            class="w-full font-mono"
          />
        </UFormField>
        <p class="text-xs text-muted -mt-2">
          Apps will be accessible at
          <code>myapp.example.com</code>.
        </p>

        <div class="flex gap-2">
          <UButton
            icon="i-lucide-save"
            :loading="appsState.saving"
            :disabled="!appsState.baseDomain || (!sharedToken && !config?.apiToken)"
            @click="handleSave('apps')"
          >
            Save
          </UButton>
        </div>
      </div>

      <!-- Databases DNS -->
      <div class="rounded-xl border border-default bg-elevated/50 p-5 space-y-4">
        <div class="flex items-start justify-between">
          <div>
            <div class="flex items-center gap-2">
              <UIcon
                name="i-lucide-database"
                class="size-4 text-muted"
              />
              <h2 class="text-base font-semibold text-highlighted">
                Databases
              </h2>
              <UBadge
                v-if="config?.db.configured"
                color="success"
                variant="subtle"
                size="xs"
                icon="i-lucide-shield-check"
                label="Verified"
              />
            </div>
            <p class="text-xs text-muted mt-0.5">
              <code>mongodb+srv://</code>
              for replica sets
            </p>
          </div>
          <UButton
            v-if="config?.db.configured"
            icon="i-lucide-trash"
            color="error"
            variant="ghost"
            @click="dbState.confirmRemoveOpen = true"
          />
        </div>

        <!-- Active status -->
        <div
          v-if="config?.db.configured"
          class="rounded-lg bg-success/10 border border-success/20 px-3 py-2 text-xs space-y-0.5"
        >
          <p class="font-medium text-success">
            {{ config?.db?.baseDomain }}
          </p>
          <p class="text-muted font-mono">
            Zone: {{ config?.db?.zoneId }}
          </p>
        </div>

        <!-- Form -->
        <UFormField label="Base Domain">
          <UInput
            v-model="dbState.baseDomain"
            placeholder="db.example.com"
            class="w-full font-mono"
          />
        </UFormField>
        <p class="text-xs text-muted -mt-2">
          Replica sets resolve as
          <code>mongodb+srv://mydb.db.example.com</code>.
        </p>

        <div class="flex gap-2">
          <UButton
            icon="i-lucide-save"
            :loading="dbState.saving"
            :disabled="!dbState.baseDomain || (!sharedToken && !config?.apiToken)"
            @click="handleSave('db')"
          >
            Save
          </UButton>
        </div>
      </div>
    </div>

    <!-- How it works -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-3">
      <h2 class="text-base font-semibold text-highlighted">
        How it works
      </h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
        <div class="space-y-1">
          <p class="font-medium flex items-center gap-2">
            <UIcon
              name="i-lucide-layout-grid"
              class="size-4 text-muted"
            />
            Apps
          </p>
          <p class="text-muted">
            When you deploy an app, the control plane creates an A record pointing
            <code>myapp.example.com</code>
            to the server, and Caddy routes traffic.
          </p>
        </div>
        <div class="space-y-1">
          <p class="font-medium flex items-center gap-2">
            <UIcon
              name="i-lucide-database"
              class="size-4 text-muted"
            />
            Databases
          </p>
          <p class="text-muted">
            After a replica set is provisioned, clicking
            <strong>Configure DNS</strong>
            on the database page creates A + SRV + TXT records, giving you a single
            <code>mongodb+srv://</code>
            URL.
          </p>
        </div>
      </div>
    </div>

    <!-- Confirm remove modals -->
    <UModal
      v-model:open="appsState.confirmRemoveOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Remove Apps DNS?
        </h3>
      </template>
      <template #body>
        <div class="p-6">
          <p class="text-muted">
            This removes the saved Apps DNS configuration. Existing DNS records
            already created are
            <strong>not deleted</strong>
            — manage those from your Cloudflare dashboard.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="appsState.confirmRemoveOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="appsState.removing"
          icon="i-lucide-trash"
          @click="handleRemove('apps')"
        >
          Remove
        </UButton>
      </template>
    </UModal>

    <UModal
      v-model:open="dbState.confirmRemoveOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Remove Databases DNS?
        </h3>
      </template>
      <template #body>
        <div class="p-6">
          <p class="text-muted">
            This removes the saved Databases DNS configuration. Existing SRV / A / TXT
            records are
            <strong>not deleted</strong>
            — use
            <strong>Delete DNS</strong>
            on each database page to remove them from Cloudflare.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dbState.confirmRemoveOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="dbState.removing"
          icon="i-lucide-trash"
          @click="handleRemove('db')"
        >
          Remove
        </UButton>
      </template>
    </UModal>
  </div>
</template>
