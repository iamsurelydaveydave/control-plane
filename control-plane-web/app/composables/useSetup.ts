/**
 * useSetup — platform initialization composable mirroring Kubero's setup flow.
 *
 * 4-step wizard:
 * 1. Configure — paste kubeconfig, select context
 * 2. Save — persist config, generate env vars
 * 3. Check — verify required components (ingress, metrics, etc.)
 * 4. Download — generate .env file for backup
 */
export default function useSetup() {
  const { $api } = useNuxtApp()

  // Reactive state
  const isInitialized = useState<boolean | null>('setup:initialized', () => null)
  const setupEnabled = useState<boolean>('setup:enabled', () => true)
  const kubeconfigConfigured = useState<boolean>('setup:kubeconfigConfigured', () => false)

  // Setup wizard state
  const step = useState<number>('setup:step', () => 1)
  const kubeConfig = useState<string>('setup:kubeConfig', () => '')
  const kubeContext = useState<string>('setup:kubeContext', () => '')
  const kubeContextItems = useState<string[]>('setup:kubeContextItems', () => [])
  const kubeconfigError = useState<string>('setup:kubeconfigError', () => '')
  const kubeconfigValid = useState<boolean>('setup:kubeconfigValid', () => false)
  const clusterInfo = useState<{ version: string; platform: string } | null>('setup:clusterInfo', () => null)

  // Config values
  const dotenv = useState<Record<string, string>>('setup:dotenv', () => ({
    KUBECONFIG_BASE64: '',
    CONTROLPLANE_CONTEXT: '',
    CONTROLPLANE_NAMESPACE: 'controlplane',
    CONTROLPLANE_SESSION_KEY: '',
    CONTROLPLANE_WEBHOOK_SECRET: '',
  }))

  // Component status
  const installedComponents = useState<{
    operator: boolean
    ingress: boolean
    metrics: boolean
    'cert-manager': boolean
  }>('setup:components', () => ({
    operator: false,
    ingress: false,
    metrics: false,
    'cert-manager': false,
  }))

  // Save status
  const saveSuccess = useState<'ok' | 'error' | ''>('setup:saveSuccess', () => '')
  const saveErrorMessage = useState<string>('setup:saveErrorMessage', () => '')

  // =============================================================================
  // API Functions
  // =============================================================================

  /**
   * Check platform initialization status.
   */
  async function checkStatus(): Promise<boolean> {
    try {
      const data = await $api<{
        initialized: boolean
        setupEnabled: boolean
        kubeconfigConfigured: boolean
        apiUrl: string | null
      }>('/setup/status', { method: 'GET' })

      isInitialized.value = data.initialized
      setupEnabled.value = data.setupEnabled
      kubeconfigConfigured.value = data.kubeconfigConfigured

      return data.initialized
    } catch (err) {
      console.error('[useSetup] Status check failed:', err)
      isInitialized.value = false
      return false
    }
  }

  /**
   * Validate kubeconfig against the cluster.
   */
  async function validateKubeconfig(): Promise<boolean> {
    if (!kubeConfig.value) {
      kubeconfigError.value = ''
      kubeconfigValid.value = false
      return false
    }

    if (!kubeContext.value) {
      kubeconfigError.value = 'Context is not selected'
      kubeconfigValid.value = false
      return false
    }

    try {
      const response = await $api<{
        valid: boolean
        error?: string
        clusterInfo?: { version: string; platform: string }
      }>('/setup/kubeconfig/validate', {
        method: 'POST',
        body: {
          kubeconfig: kubeConfig.value,
          context: kubeContext.value,
        },
      })

      if (response.valid) {
        kubeconfigError.value = ''
        kubeconfigValid.value = true
        clusterInfo.value = response.clusterInfo || null
        return true
      } else {
        kubeconfigError.value = response.error || 'Invalid kubeconfig'
        kubeconfigValid.value = false
        return false
      }
    } catch (error: any) {
      kubeconfigError.value = error?.data?.error || error?.message || 'Validation failed'
      kubeconfigValid.value = false
      return false
    }
  }

  /**
   * Parse kubeconfig YAML and extract contexts.
   */
  function parseKubeconfig() {
    kubeconfigError.value = ''
    kubeconfigValid.value = false
    kubeContextItems.value = []

    if (!kubeConfig.value) return

    try {
      // Simple YAML parsing for contexts
      // Look for "contexts:" section and extract names
      const lines = kubeConfig.value.split('\n')
      let inContexts = false
      let currentIndent = 0
      const contexts: string[] = []
      let currentContext = ''

      for (const line of lines) {
        if (line.trim() === 'contexts:') {
          inContexts = true
          currentIndent = line.indexOf('contexts:')
          continue
        }

        if (inContexts) {
          // Check if we've left the contexts section
          if (line.trim() && !line.startsWith(' ') && !line.startsWith('\t') && !line.startsWith('-')) {
            if (!line.startsWith('- ')) {
              inContexts = false
              continue
            }
          }

          // Look for "- name:" pattern
          const nameMatch = line.match(/^\s*-?\s*name:\s*(.+)$/)
          if (nameMatch && nameMatch[1]) {
            contexts.push(nameMatch[1].trim())
          }

          // Also look for "- context:" followed by indented "name:"
          const contextMatch = line.match(/^\s*-\s*context:/)
          if (contextMatch) {
            // Next line should have cluster/namespace/user, look ahead for name
            continue
          }
        }

        // Look for current-context
        const currentContextMatch = line.match(/^current-context:\s*(.+)$/)
        if (currentContextMatch && currentContextMatch[1]) {
          currentContext = currentContextMatch[1].trim()
        }
      }

      kubeContextItems.value = contexts

      // Set current context
      if (currentContext && contexts.includes(currentContext)) {
        kubeContext.value = currentContext
      } else if (contexts.length > 0 && contexts[0]) {
        kubeContext.value = contexts[0]
      }
    } catch (error) {
      kubeconfigError.value = 'Failed to parse kubeconfig'
    }
  }

  /**
   * Generate config values from kubeconfig.
   */
  function generateConfig() {
    // Base64 encode the kubeconfig
    dotenv.value.KUBECONFIG_BASE64 = btoa(kubeConfig.value)
    dotenv.value.CONTROLPLANE_CONTEXT = kubeContext.value

    // Generate random session key and webhook secret
    const randomString = () =>
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)

    dotenv.value.CONTROLPLANE_SESSION_KEY = randomString()
    dotenv.value.CONTROLPLANE_WEBHOOK_SECRET = randomString()
  }

  /**
   * Save configuration to the running instance.
   */
  async function saveConfig(): Promise<boolean> {
    try {
      const response = await $api<{
        status: 'ok' | 'error'
        error?: string
        clusterInfo?: { version: string; platform: string }
      }>('/setup/save', {
        method: 'POST',
        body: dotenv.value,
      })

      if (response.status === 'ok') {
        saveSuccess.value = 'ok'
        saveErrorMessage.value = ''
        clusterInfo.value = response.clusterInfo || null

        // Check components after save
        await checkAllComponents()
        return true
      } else {
        saveSuccess.value = 'error'
        saveErrorMessage.value = response.error || 'Failed to save configuration'
        return false
      }
    } catch (error: any) {
      saveSuccess.value = 'error'
      saveErrorMessage.value = error?.data?.error || error?.message || 'Failed to save configuration'
      return false
    }
  }

  /**
   * Check if a component is installed.
   */
  async function checkComponent(
    component: 'operator' | 'ingress' | 'metrics' | 'cert-manager'
  ): Promise<boolean> {
    try {
      const response = await $api<{ status: 'ok' | 'error'; reason?: string }>(
        `/setup/check/${component}`,
        { method: 'GET' }
      )

      installedComponents.value[component] = response.status === 'ok'
      return response.status === 'ok'
    } catch {
      installedComponents.value[component] = false
      return false
    }
  }

  /**
   * Check all components.
   */
  async function checkAllComponents(): Promise<void> {
    await Promise.all([
      checkComponent('operator'),
      checkComponent('ingress'),
      checkComponent('metrics'),
      checkComponent('cert-manager'),
    ])
  }

  /**
   * Initialize the platform with admin user.
   */
  async function initialize(email: string, password: string) {
    const data = await $api<{ message: string; userId: string }>('/setup/init', {
      method: 'POST',
      body: { email, password },
    })

    isInitialized.value = true
    return data
  }

  /**
   * Generate .env content for download.
   */
  function generateEnvContent(): string {
    let envContent = '# Control Plane Configuration\n'
    envContent += '# Generated by setup wizard\n'
    envContent += `# Date: ${new Date().toISOString()}\n\n`

    for (const [key, value] of Object.entries(dotenv.value)) {
      if (value) {
        envContent += `${key}=${value}\n`
      }
    }

    return envContent
  }

  /**
   * Download .env file.
   */
  function downloadEnv(filename: string = '.env') {
    const content = generateEnvContent()
    const element = document.createElement('a')
    element.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(content))
    element.setAttribute('download', filename)
    element.style.display = 'none'
    document.body.appendChild(element)
    element.click()
    document.body.removeChild(element)
  }

  /**
   * Reset the setup wizard state.
   */
  function reset() {
    step.value = 1
    kubeConfig.value = ''
    kubeContext.value = ''
    kubeContextItems.value = []
    kubeconfigError.value = ''
    kubeconfigValid.value = false
    clusterInfo.value = null
    saveSuccess.value = ''
    saveErrorMessage.value = ''
    dotenv.value = {
      KUBECONFIG_BASE64: '',
      CONTROLPLANE_CONTEXT: '',
      CONTROLPLANE_NAMESPACE: 'controlplane',
      CONTROLPLANE_SESSION_KEY: '',
      CONTROLPLANE_WEBHOOK_SECRET: '',
    }
    installedComponents.value = {
      operator: false,
      ingress: false,
      metrics: false,
      'cert-manager': false,
    }
  }

  // =============================================================================
  // Computed
  // =============================================================================

  const componentsInstalled = computed(() =>
    installedComponents.value.ingress
  )

  const toDotenv = computed(() => generateEnvContent())

  return {
    // State
    isInitialized,
    setupEnabled,
    kubeconfigConfigured,
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

    // Computed
    componentsInstalled,
    toDotenv,

    // Methods
    checkStatus,
    validateKubeconfig,
    parseKubeconfig,
    generateConfig,
    saveConfig,
    checkComponent,
    checkAllComponents,
    initialize,
    generateEnvContent,
    downloadEnv,
    reset,
  }
}
