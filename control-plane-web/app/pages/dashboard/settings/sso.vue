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
            Single Sign-On (SSO)
          </h1>
        </div>
        <p class="text-sm text-muted ml-9">
          Configure SAML or OIDC for enterprise authentication.
        </p>
      </div>

      <!-- Actions -->
      <div class="flex items-center justify-between mb-4">
        <p class="text-sm text-muted">
          {{ configsList.length }} configuration{{ configsList.length === 1 ? '' : 's' }}
        </p>
        <UButton
          icon="i-lucide-plus"
          @click="openAdd"
        >
          Add SSO Config
        </UButton>
      </div>

      <!-- Loading -->
      <div
        v-if="configsLoading"
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
        v-else-if="!configsList.length"
        class="rounded-xl border border-default bg-elevated/50 p-12 text-center"
      >
        <UIcon
          name="i-lucide-shield-check"
          class="mx-auto mb-3 size-10 text-muted"
        />
        <h3 class="font-medium text-highlighted">
          No SSO configurations
        </h3>
        <p class="mt-1 text-sm text-muted mb-4">
          Set up SAML or OIDC for enterprise authentication.
        </p>
        <UButton
          variant="subtle"
          icon="i-lucide-plus"
          @click="openAdd"
        >
          Add SSO Config
        </UButton>
      </div>

      <!-- Configs list -->
      <div
        v-else
        class="space-y-2"
      >
        <div
          v-for="config in configsList"
          :key="config._id"
          class="rounded-xl border border-default bg-elevated/50 p-4"
        >
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <div class="flex size-10 shrink-0 items-center justify-center rounded-lg bg-elevated border border-default">
                <UIcon
                  :name="config.type === 'saml' ? 'i-lucide-key-round' : 'i-lucide-lock'"
                  class="size-5 text-muted"
                />
              </div>
              <div>
                <div class="flex items-center gap-2">
                  <span class="font-medium text-highlighted">{{ config.name }}</span>
                  <UBadge
                    v-if="config.isDefault"
                    color="primary"
                    variant="soft"
                    size="xs"
                  >
                    Default
                  </UBadge>
                  <UBadge
                    :color="statusColor[config.status] || 'neutral'"
                    variant="soft"
                    size="xs"
                  >
                    {{ config.status }}
                  </UBadge>
                  <UBadge
                    color="neutral"
                    variant="soft"
                    size="xs"
                  >
                    {{ config.type.toUpperCase() }}
                  </UBadge>
                </div>
                <p class="text-xs text-muted mt-1 font-mono">
                  {{ config.domain }}
                </p>
                <p
                  v-if="config.lastTestedAt"
                  class="text-xs text-muted mt-0.5"
                >
                  Last tested {{ formatDate(config.lastTestedAt) }}
                </p>
              </div>
            </div>

            <UDropdownMenu
              :items="[
                [
                  { label: 'Test Connection', icon: 'i-lucide-play', onSelect: () => handleTest(config) },
                  ...(config.isDefault ? [] : [{ label: 'Set as Default', icon: 'i-lucide-star', onSelect: () => handleSetDefault(config) }])
                ],
                [{ label: 'Delete', icon: 'i-lucide-trash', color: 'error' as const, onSelect: () => openDelete(config) }]
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

          <!-- Config details -->
          <div class="mt-3 p-3 bg-muted/50 rounded-lg">
            <template v-if="config.type === 'saml' && config.saml">
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span class="text-muted">Entity ID:</span>
                  <code class="ml-1 break-all">{{ config.saml.entityId }}</code>
                </div>
                <div>
                  <span class="text-muted">SSO URL:</span>
                  <code class="ml-1 break-all">{{ config.saml.ssoUrl }}</code>
                </div>
              </div>
            </template>
            <template v-else-if="config.type === 'oidc' && config.oidc">
              <div class="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span class="text-muted">Issuer:</span>
                  <code class="ml-1 break-all">{{ config.oidc.issuer }}</code>
                </div>
                <div>
                  <span class="text-muted">Client ID:</span>
                  <code class="ml-1 break-all">{{ config.oidc.clientId }}</code>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </div>

    <!-- Add SSO Config Modal -->
    <UModal
      v-model:open="dialogAdd"
      class="max-w-lg"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Add SSO Configuration
        </h3>
      </template>

      <template #body>
        <div class="p-6 space-y-4">
          <UAlert
            v-if="message"
            color="error"
            variant="soft"
            :title="message"
          />

          <UFormField label="Configuration name">
            <UInput
              v-model="form.name"
              placeholder="Corporate SSO"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Type">
            <USelect
              v-model="form.type"
              :items="[
                { value: 'saml', label: 'SAML 2.0' },
                { value: 'oidc', label: 'OpenID Connect (OIDC)' }
              ]"
              class="w-full"
            />
          </UFormField>

          <UFormField label="Domain">
            <UInput
              v-model="form.domain"
              placeholder="company.com"
              class="w-full"
            />
            <template #hint>
              <span class="text-xs text-muted">
                Users with this email domain will use this SSO config.
              </span>
            </template>
          </UFormField>

          <!-- SAML fields -->
          <template v-if="form.type === 'saml'">
            <UFormField label="Entity ID (Issuer)">
              <UInput
                v-model="form.saml!.entityId"
                placeholder="https://idp.example.com"
                class="w-full"
              />
            </UFormField>

            <UFormField label="SSO URL">
              <UInput
                v-model="form.saml!.ssoUrl"
                placeholder="https://idp.example.com/sso/saml"
                class="w-full"
              />
            </UFormField>

            <UFormField label="X.509 Certificate">
              <UTextarea
                v-model="form.saml!.certificate"
                placeholder="-----BEGIN CERTIFICATE-----
...
-----END CERTIFICATE-----"
                :rows="6"
                class="w-full font-mono text-xs"
              />
            </UFormField>
          </template>

          <!-- OIDC fields -->
          <template v-if="form.type === 'oidc'">
            <UFormField label="Issuer URL">
              <UInput
                v-model="form.oidc!.issuer"
                placeholder="https://accounts.google.com"
                class="w-full"
              />
            </UFormField>

            <div class="grid grid-cols-2 gap-3">
              <UFormField label="Client ID">
                <UInput
                  v-model="form.oidc!.clientId"
                  placeholder="your-client-id"
                  class="w-full"
                />
              </UFormField>
              <UFormField label="Client Secret">
                <UInput
                  v-model="form.oidc!.clientSecret"
                  type="password"
                  placeholder="••••••••"
                  class="w-full"
                />
              </UFormField>
            </div>
          </template>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogAdd = false"
        >
          Cancel
        </UButton>
        <UButton
          :loading="loadingForm"
          :disabled="!isFormValid"
          icon="i-lucide-plus"
          @click="submitAdd"
        >
          Add Configuration
        </UButton>
      </template>
    </UModal>

    <!-- Test Result Modal -->
    <UModal
      v-model:open="dialogTest"
      class="max-w-sm"
    >
      <template #header>
        <h3 class="text-lg font-semibold">
          Test SSO — {{ testTarget?.name }}
        </h3>
      </template>

      <template #body>
        <div class="p-6">
          <div
            v-if="testing"
            class="text-center py-4"
          >
            <UIcon
              name="i-lucide-loader-2"
              class="size-8 animate-spin text-muted mb-2"
            />
            <p class="text-muted">
              Testing connection...
            </p>
          </div>

          <div
            v-else-if="testResult"
            class="flex items-start gap-4"
          >
            <div
              class="flex size-10 shrink-0 items-center justify-center rounded-full"
              :class="testResult.success ? 'bg-success/10' : 'bg-error/10'"
            >
              <UIcon
                :name="testResult.success ? 'i-lucide-check-circle' : 'i-lucide-x-circle'"
                :class="testResult.success ? 'text-success' : 'text-error'"
                class="size-5"
              />
            </div>
            <div>
              <p :class="testResult.success ? 'text-success' : 'text-error'">
                {{ testResult.success ? 'Connection successful' : 'Connection failed' }}
              </p>
              <p
                v-if="testResult.error"
                class="text-sm text-muted mt-1"
              >
                {{ testResult.error }}
              </p>
            </div>
          </div>
        </div>
      </template>

      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          @click="dialogTest = false"
        >
          Close
        </UButton>
      </template>
    </UModal>

    <!-- Delete Confirmation -->
    <ConfirmDialog
      v-model:open="dialogDelete"
      v-model:message="deleteMessage"
      title="Delete SSO Configuration"
      :content="`Are you sure you want to delete '${deleteTarget?.name}'? Users from ${deleteTarget?.domain} will no longer be able to sign in with SSO.`"
      confirm-label="Delete"
      color="error"
      :loading="deleting"
      @confirm="submitDelete"
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
const { getAll, add, deleteById, testConnection, setDefault } = useSSO()

// Data fetching
const { data: configsData, refresh: refreshConfigs, status: configsStatus } = useLazyAsyncData(
  'sso-configs',
  () => getAll().catch(() => ({ items: [] })),
  { server: false }
)
const configsLoading = computed(() => configsStatus.value === 'pending')
const configsList = computed(() => configsData.value?.items ?? [])

// Dialog state
const dialogAdd = ref(false)
const loadingForm = ref(false)
const message = ref('')

const dialogDelete = ref(false)
const deleteTarget = ref<TSSConfig | null>(null)
const deleteMessage = ref('')
const deleting = ref(false)

const dialogTest = ref(false)
const testTarget = ref<TSSConfig | null>(null)
const testResult = ref<{ success: boolean, error?: string } | null>(null)
const testing = ref(false)

// Form
const form = reactive<TSSOConfigForm>({
  name: '',
  type: 'saml',
  domain: '',
  saml: {
    entityId: '',
    ssoUrl: '',
    certificate: ''
  },
  oidc: {
    issuer: '',
    clientId: '',
    clientSecret: ''
  }
})

const isFormValid = computed(() => {
  if (!form.name || !form.domain) return false
  if (form.type === 'saml') {
    return form.saml?.entityId && form.saml?.ssoUrl && form.saml?.certificate
  }
  if (form.type === 'oidc') {
    return form.oidc?.issuer && form.oidc?.clientId
  }
  return false
})

function openAdd() {
  Object.assign(form, {
    name: '',
    type: 'saml',
    domain: '',
    saml: {
      entityId: '',
      ssoUrl: '',
      certificate: ''
    },
    oidc: {
      issuer: '',
      clientId: '',
      clientSecret: ''
    }
  })
  message.value = ''
  dialogAdd.value = true
}

async function submitAdd() {
  if (loadingForm.value) return
  loadingForm.value = true
  try {
    const payload: TSSOConfigForm = {
      name: form.name,
      type: form.type,
      domain: form.domain
    }
    if (form.type === 'saml') {
      payload.saml = form.saml
    } else {
      payload.oidc = form.oidc
    }
    await add(payload)
    toast.add({ title: 'SSO configuration added', color: 'success', icon: 'i-lucide-check' })
    dialogAdd.value = false
    await refreshConfigs()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    message.value = err?.data?.message || 'Failed to add SSO configuration'
  } finally {
    loadingForm.value = false
  }
}

function openDelete(config: TSSConfig) {
  deleteTarget.value = config
  deleteMessage.value = ''
  dialogDelete.value = true
}

async function submitDelete() {
  if (!deleteTarget.value || deleting.value) return
  deleting.value = true
  try {
    await deleteById(deleteTarget.value._id)
    toast.add({ title: 'SSO configuration deleted', color: 'success', icon: 'i-lucide-check' })
    dialogDelete.value = false
    deleteTarget.value = null
    await refreshConfigs()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    deleteMessage.value = err?.data?.message || 'Failed to delete SSO configuration'
  } finally {
    deleting.value = false
  }
}

async function handleTest(config: TSSConfig) {
  testTarget.value = config
  testResult.value = null
  dialogTest.value = true
  testing.value = true
  try {
    const result = await testConnection(config._id)
    testResult.value = result
    if (result.success) {
      toast.add({ title: 'SSO test successful', color: 'success', icon: 'i-lucide-check-circle' })
    }
    await refreshConfigs()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    testResult.value = { success: false, error: err?.data?.message || 'Test failed' }
  } finally {
    testing.value = false
  }
}

async function handleSetDefault(config: TSSConfig) {
  try {
    await setDefault(config._id)
    toast.add({ title: `${config.name} set as default`, color: 'success', icon: 'i-lucide-check' })
    await refreshConfigs()
  } catch (e: unknown) {
    const err = e as { data?: { message?: string } }
    toast.add({ title: err?.data?.message || 'Failed to set default', color: 'error' })
  }
}

// Status helpers
const statusColor: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  pending: 'neutral',
  active: 'success',
  inactive: 'neutral',
  failed: 'error'
}

function formatDate(value?: string) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

useHead({ title: 'SSO · Settings · Control Plane' })
</script>
