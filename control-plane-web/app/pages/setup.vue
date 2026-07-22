<template>
  <div class="min-h-dvh bg-default">
    <!-- Header -->
    <div class="border-b border-default bg-elevated">
      <div class="mx-auto max-w-4xl px-4 py-6">
        <div class="flex items-center gap-3">
          <span class="flex size-10 items-center justify-center rounded-lg bg-primary text-inverted">
            <UIcon name="i-lucide-cloud" class="size-6" />
          </span>
          <div>
            <h1 class="text-xl font-bold text-highlighted">Control Plane Setup</h1>
            <p class="text-sm text-muted">Configure your Kubernetes cluster connection</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Stepper -->
    <div class="mx-auto max-w-4xl px-4 py-8">
      <!-- Step Indicators -->
      <div class="mb-8">
        <nav aria-label="Progress">
          <ol class="flex items-center justify-between">
            <li
              v-for="(s, idx) in steps"
              :key="s.id"
              class="relative flex flex-1 items-center"
            >
              <!-- Connector line -->
              <div
                v-if="idx > 0"
                class="absolute left-0 top-4 -ml-px h-0.5 w-full -translate-x-full"
                :class="step > idx ? 'bg-primary' : 'bg-muted/30'"
              />

              <div class="relative flex flex-col items-center">
                <!-- Step circle -->
                <span
                  class="flex size-8 items-center justify-center rounded-full border-2 text-sm font-semibold"
                  :class="{
                    'border-primary bg-primary text-inverted': step > idx + 1,
                    'border-primary text-primary': step === idx + 1,
                    'border-muted/50 text-muted': step < idx + 1,
                  }"
                >
                  <UIcon v-if="step > idx + 1" name="i-lucide-check" class="size-4" />
                  <span v-else>{{ idx + 1 }}</span>
                </span>
                <!-- Step label -->
                <span
                  class="mt-2 text-xs font-medium"
                  :class="step >= idx + 1 ? 'text-highlighted' : 'text-muted'"
                >
                  {{ s.title }}
                </span>
              </div>
            </li>
          </ol>
        </nav>
      </div>

      <!-- Step Content -->
      <UCard class="mb-6">
        <!-- Step 1: Configure Kubeconfig -->
        <div v-if="step === 1" class="space-y-6">
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-info"
            title="Kubernetes Configuration"
            description="Control Plane needs access to your Kubernetes cluster. Paste your kubeconfig below to get started."
          />

          <UFormField label="Kubeconfig" hint="kubectl config view --raw --minify --flatten">
            <UTextarea
              v-model="kubeConfig"
              :rows="16"
              placeholder="apiVersion: v1
clusters:
- cluster:
    certificate-authority-data: LS0tLS1CRUdJTi...
    server: https://your-cluster:6443
  name: my-cluster
contexts:
- context:
    cluster: my-cluster
    user: admin
  name: my-cluster
current-context: my-cluster
kind: Config
users:
- name: admin
  user:
    client-certificate-data: LS0tLS1CRUdJTi..."
              class="font-mono text-sm"
              @update:model-value="onKubeconfigChange"
            />
          </UFormField>

          <UFormField label="Context" hint="The Kubernetes context to use">
            <USelectMenu
              v-model="kubeContext"
              :items="kubeContextItems"
              placeholder="Select a context"
              :disabled="kubeContextItems.length === 0"
            />
          </UFormField>

          <UAlert
            v-if="kubeconfigValid && clusterInfo"
            color="success"
            variant="subtle"
            icon="i-lucide-check-circle"
            title="Cluster Connected"
            :description="`Successfully connected to cluster. Version: ${clusterInfo.version}, Platform: ${clusterInfo.platform}`"
          />

          <UAlert
            v-if="kubeconfigError"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Connection Failed"
            :description="kubeconfigError"
          />
        </div>

        <!-- Step 2: Save Configuration -->
        <div v-if="step === 2" class="space-y-6">
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-save"
            title="Save Configuration"
            description="Review and save your configuration. This will update the running instance and create the Control Plane namespace."
          />

          <div class="grid gap-4">
            <UFormField label="Kubeconfig (base64)" hint="Base64-encoded kubeconfig">
              <UInput
                :model-value="(dotenv.KUBECONFIG_BASE64 || '').substring(0, 50) + '...'"
                readonly
                icon="i-lucide-file-code"
              />
            </UFormField>

            <UFormField label="Context">
              <UInput
                v-model="dotenv.CONTROLPLANE_CONTEXT"
                readonly
                icon="i-lucide-git-branch"
              />
            </UFormField>

            <UFormField label="Namespace" hint="Kubernetes namespace for Control Plane resources">
              <UInput
                v-model="dotenv.CONTROLPLANE_NAMESPACE"
                icon="i-lucide-folder"
              />
            </UFormField>

            <UFormField label="Session Key" hint="Generated random key for sessions">
              <UInput
                :model-value="(dotenv.CONTROLPLANE_SESSION_KEY || '').substring(0, 20) + '...'"
                readonly
                icon="i-lucide-key"
              />
            </UFormField>

            <UFormField label="Webhook Secret" hint="Generated secret for webhook verification">
              <UInput
                :model-value="(dotenv.CONTROLPLANE_WEBHOOK_SECRET || '').substring(0, 20) + '...'"
                readonly
                icon="i-lucide-shield"
              />
            </UFormField>
          </div>

          <div class="flex justify-center pt-4">
            <UButton
              color="primary"
              size="lg"
              icon="i-lucide-save"
              :loading="saving"
              @click="onSave"
            >
              Save Configuration
            </UButton>
          </div>

          <UAlert
            v-if="saveSuccess === 'ok'"
            color="success"
            variant="subtle"
            icon="i-lucide-check-circle"
            title="Configuration Saved"
            description="Your configuration has been saved successfully. Proceeding to component checks..."
          />

          <UAlert
            v-if="saveSuccess === 'error'"
            color="error"
            variant="subtle"
            icon="i-lucide-circle-alert"
            title="Save Failed"
            :description="saveErrorMessage"
          />
        </div>

        <!-- Step 3: Check Components -->
        <div v-if="step === 3" class="space-y-6">
          <UAlert
            color="info"
            variant="subtle"
            icon="i-lucide-check-square"
            title="Component Check"
            description="Verifying that required Kubernetes components are installed in your cluster."
          />

          <!-- Ingress Controller -->
          <div class="rounded-lg border border-default p-4">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="installedComponents.ingress ? 'i-lucide-check-circle' : 'i-lucide-circle-x'"
                    :class="installedComponents.ingress ? 'text-success' : 'text-error'"
                    class="size-5"
                  />
                  <h3 class="font-semibold text-highlighted">Ingress Controller</h3>
                  <UBadge
                    :color="installedComponents.ingress ? 'success' : 'error'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ installedComponents.ingress ? 'Installed' : 'Not Found' }}
                  </UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">
                  Required for routing external traffic to your applications.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                @click="checkComponent('ingress')"
              />
            </div>

            <div v-if="!installedComponents.ingress" class="mt-4">
              <p class="mb-2 text-sm text-muted">Install with:</p>
              <div class="rounded-md bg-elevated p-3">
                <code class="text-xs text-highlighted">
                  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.10.0/deploy/static/provider/cloud/deploy.yaml
                </code>
              </div>
            </div>
          </div>

          <!-- Metrics Server -->
          <div class="rounded-lg border border-default p-4">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="installedComponents.metrics ? 'i-lucide-check-circle' : 'i-lucide-circle-x'"
                    :class="installedComponents.metrics ? 'text-success' : 'text-warning'"
                    class="size-5"
                  />
                  <h3 class="font-semibold text-highlighted">Metrics Server</h3>
                  <UBadge
                    :color="installedComponents.metrics ? 'success' : 'warning'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ installedComponents.metrics ? 'Installed' : 'Optional' }}
                  </UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">
                  Enables resource usage metrics (CPU, memory) for pods and nodes.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                @click="checkComponent('metrics')"
              />
            </div>

            <div v-if="!installedComponents.metrics" class="mt-4">
              <p class="mb-2 text-sm text-muted">Install with:</p>
              <div class="rounded-md bg-elevated p-3">
                <code class="text-xs text-highlighted">
                  kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml
                </code>
              </div>
            </div>
          </div>

          <!-- Cert Manager -->
          <div class="rounded-lg border border-default p-4">
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-2">
                  <UIcon
                    :name="installedComponents['cert-manager'] ? 'i-lucide-check-circle' : 'i-lucide-circle-x'"
                    :class="installedComponents['cert-manager'] ? 'text-success' : 'text-warning'"
                    class="size-5"
                  />
                  <h3 class="font-semibold text-highlighted">Cert Manager</h3>
                  <UBadge
                    :color="installedComponents['cert-manager'] ? 'success' : 'warning'"
                    variant="subtle"
                    size="xs"
                  >
                    {{ installedComponents['cert-manager'] ? 'Installed' : 'Optional' }}
                  </UBadge>
                </div>
                <p class="mt-1 text-sm text-muted">
                  Automates TLS certificate management with Let's Encrypt.
                </p>
              </div>
              <UButton
                color="neutral"
                variant="ghost"
                size="sm"
                icon="i-lucide-refresh-cw"
                @click="checkComponent('cert-manager')"
              />
            </div>

            <div v-if="!installedComponents['cert-manager']" class="mt-4">
              <p class="mb-2 text-sm text-muted">Install with:</p>
              <div class="rounded-md bg-elevated p-3">
                <code class="text-xs text-highlighted">
                  kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.14.4/cert-manager.yaml
                </code>
              </div>
            </div>
          </div>

          <UAlert
            v-if="componentsInstalled"
            color="success"
            variant="subtle"
            icon="i-lucide-check-circle"
            title="Ready to Continue"
            description="Required components are installed. You can proceed to the next step."
          />

          <UAlert
            v-else
            color="warning"
            variant="subtle"
            icon="i-lucide-alert-triangle"
            title="Missing Components"
            description="Install the required ingress controller before continuing. Optional components can be installed later."
          />
        </div>

        <!-- Step 4: Create Admin & Download -->
        <div v-if="step === 4" class="space-y-6">
          <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-party-popper"
            title="Almost Done!"
            description="Create your admin account and download your configuration for safekeeping."
          />

          <!-- Admin Account Form -->
          <div class="rounded-lg border border-default p-6">
            <h3 class="mb-4 font-semibold text-highlighted">Create Admin Account</h3>

            <UForm :state="adminForm" :validate="validateAdminForm" class="space-y-4" @submit="onCreateAdmin">
              <UFormField label="Email" name="email" required>
                <UInput
                  v-model="adminForm.email"
                  type="email"
                  placeholder="admin@example.com"
                  icon="i-lucide-mail"
                  :disabled="adminCreated"
                />
              </UFormField>

              <UFormField label="Password" name="password" hint="At least 8 characters" required>
                <UInput
                  v-model="adminForm.password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Create a password"
                  icon="i-lucide-lock"
                  :disabled="adminCreated"
                  :ui="{ trailing: 'pe-1' }"
                >
                  <template #trailing>
                    <UButton
                      color="neutral"
                      variant="link"
                      size="sm"
                      :icon="showPassword ? 'i-lucide-eye-off' : 'i-lucide-eye'"
                      @click="showPassword = !showPassword"
                    />
                  </template>
                </UInput>
              </UFormField>

              <UFormField label="Confirm Password" name="confirmPassword" required>
                <UInput
                  v-model="adminForm.confirmPassword"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Confirm your password"
                  icon="i-lucide-lock"
                  :disabled="adminCreated"
                />
              </UFormField>

              <UAlert
                v-if="adminError"
                color="error"
                variant="subtle"
                icon="i-lucide-circle-alert"
                :description="adminError"
              />

              <UAlert
                v-if="adminCreated"
                color="success"
                variant="subtle"
                icon="i-lucide-check-circle"
                title="Admin Account Created"
                description="You can now sign in with your admin credentials."
              />

              <UButton
                v-if="!adminCreated"
                type="submit"
                color="primary"
                block
                :loading="creatingAdmin"
                icon="i-lucide-user-plus"
              >
                Create Admin Account
              </UButton>
            </UForm>
          </div>

          <!-- Download Config -->
          <div class="rounded-lg border border-default p-6">
            <h3 class="mb-4 font-semibold text-highlighted">Download Configuration</h3>
            <p class="mb-4 text-sm text-muted">
              Save your configuration file for future deployments or disaster recovery.
            </p>

            <UTextarea
              :model-value="toDotenv"
              readonly
              :rows="8"
              class="mb-4 font-mono text-xs"
            />

            <div class="flex gap-2">
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-download"
                @click="downloadEnv('.env.controlplane')"
              >
                Download .env
              </UButton>
              <UButton
                color="neutral"
                variant="outline"
                icon="i-lucide-copy"
                @click="copyToClipboard"
              >
                Copy to Clipboard
              </UButton>
            </div>
          </div>

          <!-- Go to Dashboard -->
          <div v-if="adminCreated" class="flex justify-center pt-4">
            <UButton
              color="primary"
              size="lg"
              icon="i-lucide-arrow-right"
              trailing
              @click="goToLogin"
            >
              Continue to Login
            </UButton>
          </div>
        </div>
      </UCard>

      <!-- Navigation Buttons -->
      <div class="flex justify-between">
        <UButton
          v-if="step > 1"
          color="neutral"
          variant="outline"
          icon="i-lucide-arrow-left"
          :disabled="saving || creatingAdmin"
          @click="prevStep"
        >
          Back
        </UButton>
        <div v-else />

        <UButton
          v-if="step < 4"
          color="primary"
          icon="i-lucide-arrow-right"
          trailing
          :disabled="!canProceed"
          :loading="validating"
          @click="nextStep"
        >
          {{ step === 1 ? 'Validate & Continue' : 'Continue' }}
        </UButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'blank' })

const toast = useToast()
const router = useRouter()

const {
  step,
  kubeConfig,
  kubeContext,
  kubeContextItems,
  kubeconfigError,
  kubeconfigValid,
  clusterInfo,
  dotenv,
  installedComponents,
  saveSuccess,
  saveErrorMessage,
  componentsInstalled,
  toDotenv,
  checkStatus,
  validateKubeconfig,
  parseKubeconfig,
  generateConfig,
  saveConfig,
  checkComponent,
  checkAllComponents,
  initialize,
  downloadEnv,
} = useSetup()

const steps = [
  { id: 1, title: 'Configure' },
  { id: 2, title: 'Save' },
  { id: 3, title: 'Check' },
  { id: 4, title: 'Finish' },
]

// Local state
const validating = ref(false)
const saving = ref(false)
const creatingAdmin = ref(false)
const adminCreated = ref(false)
const adminError = ref('')
const showPassword = ref(false)

const adminForm = reactive({
  email: '',
  password: '',
  confirmPassword: '',
})

// Computed
const canProceed = computed(() => {
  switch (step.value) {
    case 1:
      return kubeConfig.value.length > 0 && kubeContext.value.length > 0
    case 2:
      return saveSuccess.value === 'ok'
    case 3:
      return componentsInstalled.value
    default:
      return true
  }
})

// Methods
function onKubeconfigChange() {
  parseKubeconfig()
  kubeconfigValid.value = false
  kubeconfigError.value = ''
}

async function nextStep() {
  if (step.value === 1) {
    // Validate kubeconfig before proceeding
    validating.value = true
    const valid = await validateKubeconfig()
    validating.value = false

    if (!valid) return

    // Generate config values
    generateConfig()
  }

  if (step.value === 2 && saveSuccess.value !== 'ok') {
    // Must save before proceeding
    return
  }

  if (step.value === 3 && !componentsInstalled.value) {
    // Must have required components
    toast.add({
      title: 'Missing Components',
      description: 'Please install the required ingress controller before continuing.',
      color: 'warning',
    })
    return
  }

  step.value++
}

function prevStep() {
  step.value--
}

async function onSave() {
  saving.value = true
  await saveConfig()
  saving.value = false

  if (saveSuccess.value === 'ok') {
    // Auto-proceed after short delay
    setTimeout(() => {
      step.value = 3
    }, 1500)
  }
}

type FieldError = { name: string; message: string }

function validateAdminForm(state: typeof adminForm): FieldError[] {
  const errors: FieldError[] = []
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

  if (!state.email) {
    errors.push({ name: 'email', message: 'Required' })
  } else if (!emailRegex.test(state.email)) {
    errors.push({ name: 'email', message: 'Please enter a valid email' })
  }

  if (!state.password) {
    errors.push({ name: 'password', message: 'Required' })
  } else if (state.password.length < 8) {
    errors.push({ name: 'password', message: 'Must be at least 8 characters' })
  }

  if (!state.confirmPassword) {
    errors.push({ name: 'confirmPassword', message: 'Required' })
  } else if (state.password !== state.confirmPassword) {
    errors.push({ name: 'confirmPassword', message: 'Passwords do not match' })
  }

  return errors
}

async function onCreateAdmin() {
  creatingAdmin.value = true
  adminError.value = ''

  try {
    await initialize(adminForm.email, adminForm.password)
    adminCreated.value = true

    toast.add({
      title: 'Admin Account Created',
      description: 'You can now sign in with your admin credentials.',
      color: 'success',
      icon: 'i-lucide-check-circle',
    })
  } catch (error: any) {
    adminError.value = error?.data?.error || error?.message || 'Failed to create admin account'
  } finally {
    creatingAdmin.value = false
  }
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(toDotenv.value)
    toast.add({
      title: 'Copied!',
      description: 'Configuration copied to clipboard.',
      color: 'success',
    })
  } catch {
    toast.add({
      title: 'Failed',
      description: 'Could not copy to clipboard.',
      color: 'error',
    })
  }
}

function goToLogin() {
  router.push('/login')
}

// On mount, check if already initialized
onMounted(async () => {
  try {
    const initialized = await checkStatus()
    if (initialized) {
      router.push('/login')
    }
  } catch {
    // API not available, stay on setup page
  }
})

useHead({ title: 'Setup · Control Plane' })
</script>
