/**
 * useCookieConfig — returns cookie options for useCookie() calls.
 *
 * Builds the config from individual runtime config values.
 */
export default function useCookieConfig() {
  const config = useRuntimeConfig().public

  // Build cookie options from individual config values
  const cookieConfig: {
    domain?: string
    secure?: boolean
    maxAge: number
  } = {
    maxAge: config.cookieMaxAge as number
  }

  // Only set domain if configured (for cross-subdomain cookies)
  if (config.cookieDomain) {
    cookieConfig.domain = config.cookieDomain as string
  }

  // Set secure flag in production
  if (config.cookieSecure) {
    cookieConfig.secure = true
  }

  return cookieConfig
}
