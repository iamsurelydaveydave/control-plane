/**
 * useSetup — platform initialization composable following goweekdays-web pattern.
 *
 * Returns reactive state and API functions. No side effects on call.
 */
export default function useSetup() {
  const isInitialized = useState<boolean | null>('setup:initialized', () => null)

  function checkStatus(): Promise<boolean> {
    console.log('[useSetup] Checking status...')
    return useNuxtApp().$api<{ initialized: boolean }>('/setup/status', {
      method: 'GET'
    }).then((data) => {
      console.log('[useSetup] Status response:', data)
      isInitialized.value = data.initialized
      return data.initialized
    }).catch((err) => {
      console.error('[useSetup] Status check failed:', err)
      isInitialized.value = false
      return false
    })
  }

  function initialize(email: string, password: string) {
    return useNuxtApp().$api<{ message: string, userId: string }>('/setup/init', {
      method: 'POST',
      body: { email, password }
    }).then((data) => {
      isInitialized.value = true
      return data
    })
  }

  return {
    isInitialized,
    checkStatus,
    initialize
  }
}
