<script setup lang="ts">
/**
 * DNS Settings — configure Cloudflare credentials for mongodb+srv:// URLs.
 */
definePageMeta({
  layout: 'dashboard',
  middleware: 'auth',
  secured: true
})

const toast = useToast()
const { getDNSConfig, verifyDNS, saveDNSConfig, removeDNSConfig } = useSettings()

// ---------------------------------------------------------------------------
// Load current config
// ---------------------------------------------------------------------------
const { data: configData, refresh: refreshConfig } = await useLazyAsyncData(
  'dns-config',
  () => getDNSConfig().catch(() => ({ configured: false })),
  { server: false, immediate: true }
)
const config = computed(() => configData.value)

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------
const form = reactive({
  apiToken: '',
  baseDomain: '',
})

// ---------------------------------------------------------------------------
// Verify step — shows discovered zone before saving
// ---------------------------------------------------------------------------
const verifyResult = ref<{ zoneId: string; zoneName: string; tokenId: string } | null>(null)
const verifying = ref(false)
const saving = ref(false)

async function handleVerify() {
  if (!form.apiToken.trim() || !form.baseDomain.trim()) {
    toast.add({ title: 'Both fields are required', color: 'error' })
    return
  }

  verifyResult.value = null
  verifying.value = true

  try {
    const result = await verifyDNS(form.apiToken.trim(), form.baseDomain.trim())

    if (!result.valid) {
      toast.add({
        title: 'Verification failed',
        description: result.error || 'Check your token and domain',
        color: 'error',
      })
      return
    }

    verifyResult.value = {
      zoneId: result.zoneId!,
      zoneName: result.zoneName!,
      tokenId: result.tokenId!,
    }
    toast.add({
      title: 'Token verified',
      description: `Zone found: ${result.zoneName} (${result.zoneId})`,
      color: 'success',
      icon: 'i-lucide-check',
    })
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Verification failed',
      description: err?.data?.message || 'Could not reach Cloudflare',
      color: 'error',
    })
  } finally {
    verifying.value = false
  }
}

async function handleSave() {
  if (!verifyResult.value) {
    toast.add({ title: 'Verify first', description: 'Click Verify before saving', color: 'warning' })
    return
  }

  saving.value = true
  try {
    await saveDNSConfig({
      apiToken: form.apiToken.trim(),
      baseDomain: form.baseDomain.trim(),
      zoneId: verifyResult.value.zoneId,
    })
    toast.add({
      title: 'DNS configuration saved',
      description: `Cloudflare zone: ${verifyResult.value.zoneName}`,
      color: 'success',
      icon: 'i-lucide-check',
    })
    form.apiToken = ''
    form.baseDomain = ''
    verifyResult.value = null
    await refreshConfig()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({
      title: 'Failed to save',
      description: err?.data?.message || 'Unknown error',
      color: 'error',
    })
  } finally {
    saving.value = false
  }
}

const removing = ref(false)
const confirmRemoveOpen = ref(false)

async function handleRemove() {
  removing.value = true
  try {
    await removeDNSConfig()
    toast.add({ title: 'DNS configuration removed', color: 'success', icon: 'i-lucide-check' })
    confirmRemoveOpen.value = false
    await refreshConfig()
  } catch {
    toast.add({ title: 'Failed to remove', color: 'error' })
  } finally {
    removing.value = false
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
          Connect Cloudflare to enable
          <code>mongodb+srv://</code>
          URLs for your replica sets.
        </p>
      </div>
    </div>

    <!-- Current status -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-4">
      <h2 class="text-base font-semibold text-highlighted">
        Current Configuration
      </h2>

      <div v-if="config?.configured" class="space-y-3">
        <UAlert
          color="success"
          variant="soft"
          icon="i-lucide-check-circle"
          title="Cloudflare connected"
          :description="`Zone: ${config.baseDomain} · Token: ${config.apiToken}`"
        />
        <div class="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span class="text-muted">Provider</span>
            <p class="font-medium capitalize">
              {{ config.provider }}
            </p>
          </div>
          <div>
            <span class="text-muted">Base Domain</span>
            <p class="font-mono font-medium">
              {{ config.baseDomain }}
            </p>
          </div>
          <div>
            <span class="text-muted">Zone ID</span>
            <p class="font-mono text-xs text-muted truncate">
              {{ config.zoneId }}
            </p>
          </div>
        </div>
        <div class="flex justify-end pt-2 border-t border-default">
          <UButton
            color="error"
            variant="ghost"
            icon="i-lucide-trash"
            size="sm"
            @click="confirmRemoveOpen = true"
          >
            Remove configuration
          </UButton>
        </div>
      </div>

      <div v-else>
        <UAlert
          color="neutral"
          variant="soft"
          icon="i-lucide-globe"
          title="Not configured"
          description="Add your Cloudflare API token below to enable DNS automation."
        />
      </div>
    </div>

    <!-- Add / update form -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-5">
      <div>
        <h2 class="text-base font-semibold text-highlighted">
          {{ config?.configured ? 'Update Credentials' : 'Add Cloudflare Credentials' }}
        </h2>
        <p class="text-sm text-muted mt-1">
          Your token needs <strong>Zone › DNS › Edit</strong> and <strong>Zone › Zone › Read</strong> permissions.
          The Zone ID is discovered automatically.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-4">
        <UFormField label="API Token" class="col-span-1">
          <UInput
            v-model="form.apiToken"
            type="password"
            placeholder="Paste your Cloudflare API token"
            class="w-full font-mono"
            autocomplete="off"
          />
        </UFormField>

        <UFormField label="Base Domain" class="col-span-1">
          <UInput
            v-model="form.baseDomain"
            placeholder="example.com"
            class="w-full font-mono"
          />
        </UFormField>
      </div>
      <p class="text-sm text-muted">
        The root domain managed by Cloudflare. Replica set URLs will be
        <code>mydb.example.com</code>.
      </p>

      <!-- Verify result -->
      <UAlert
        v-if="verifyResult"
        color="success"
        variant="soft"
        icon="i-lucide-shield-check"
        title="Token verified — ready to save"
        :description="`Zone: ${verifyResult.zoneName} (${verifyResult.zoneId})`"
      />

      <div class="flex items-center gap-3">
        <UButton
          icon="i-lucide-shield-check"
          color="neutral"
          variant="outline"
          :loading="verifying"
          :disabled="!form.apiToken || !form.baseDomain"
          @click="handleVerify"
        >
          Verify
        </UButton>
        <UButton
          icon="i-lucide-save"
          :loading="saving"
          :disabled="!verifyResult"
          @click="handleSave"
        >
          Save Configuration
        </UButton>
      </div>
    </div>

    <!-- How it works -->
    <div class="rounded-xl border border-default bg-elevated/50 p-6 space-y-3">
      <h2 class="text-base font-semibold text-highlighted">
        How it works
      </h2>
      <ol class="space-y-2 text-sm text-muted list-decimal list-inside">
        <li>Save your Cloudflare token here (one-time setup).</li>
        <li>
          Go to a running replica set database and click
          <strong class="text-default">Configure DNS</strong>.
        </li>
        <li>
          The control plane creates A, SRV and TXT records in Cloudflare
          automatically.
        </li>
        <li>
          You get a single
          <code>mongodb+srv://</code>
          connection URL — paste it into your app's
          <code>MONGO_URI</code>.
        </li>
      </ol>
      <UAlert
        color="info"
        variant="soft"
        icon="i-lucide-info"
        title="No proxy involved"
        description="The driver resolves SRV records to node hostnames, then connects directly to each node. Caddy is not involved."
      />
    </div>

    <!-- Confirm remove modal -->
    <UModal
      v-model:open="confirmRemoveOpen"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Remove DNS configuration?
        </h3>
      </template>
      <template #body>
        <div class="p-6">
          <p class="text-muted">
            This removes the saved Cloudflare credentials. Existing DNS records on databases
            are <strong>not deleted</strong> — remove those individually from each database page.
          </p>
        </div>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="confirmRemoveOpen = false"
        >
          Cancel
        </UButton>
        <UButton
          color="error"
          :loading="removing"
          icon="i-lucide-trash"
          @click="handleRemove"
        >
          Remove
        </UButton>
      </template>
    </UModal>
  </div>
</template>
