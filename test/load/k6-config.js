/**
 * k6 Load Testing Configuration for Control Plane API
 *
 * Base configuration and shared utilities for all load test scenarios.
 * Supports multiple environments: local, staging, production.
 *
 * Usage:
 *   k6 run -e ENV=local scenarios/auth.js
 *   k6 run -e ENV=staging -e API_TOKEN=xxx scenarios/api-crud.js
 */

// =============================================================================
// Environment Configuration
// =============================================================================

const environments = {
  local: {
    baseUrl: "http://localhost:3030",
    // Local testing can be more aggressive
    virtualUsers: 10,
    duration: "1m",
  },
  staging: {
    baseUrl: "https://api.staging.control-plane.example.com",
    virtualUsers: 20,
    duration: "2m",
  },
  production: {
    baseUrl: "https://api.control-plane.example.com",
    // Production should be conservative
    virtualUsers: 5,
    duration: "30s",
  },
};

/**
 * Get environment configuration
 * @returns {Object} Environment config
 */
export function getEnvConfig() {
  const env = __ENV.ENV || "local";
  const config = environments[env];

  if (!config) {
    throw new Error(`Unknown environment: ${env}. Use: local, staging, or production`);
  }

  // Allow overrides via environment variables
  return {
    ...config,
    baseUrl: __ENV.BASE_URL || config.baseUrl,
    virtualUsers: parseInt(__ENV.VUS) || config.virtualUsers,
    duration: __ENV.DURATION || config.duration,
    apiToken: __ENV.API_TOKEN || "",
    testEmail: __ENV.TEST_EMAIL || "loadtest@example.com",
    testPassword: __ENV.TEST_PASSWORD || "LoadTest123!",
  };
}

// =============================================================================
// Rate Limit Configuration (matches API settings)
// =============================================================================

/**
 * Rate limits configured in the API
 * See: control-plane-api/src/utils/rate-limiter.ts
 */
export const rateLimits = {
  /** 5 login attempts per 15 minutes — strict for auth endpoints */
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5,
    description: "Auth endpoints (login, token)",
  },
  /** 100 requests per minute — general API rate limit */
  api: {
    windowMs: 60 * 1000, // 1 minute
    max: 100,
    description: "General API endpoints",
  },
  /** 10 heavy operations per minute — deploy, provision, etc. */
  heavy: {
    windowMs: 60 * 1000, // 1 minute
    max: 10,
    description: "Heavy operations (deploy, create cluster)",
  },
  /** 20 requests per minute — moderate operations */
  moderate: {
    windowMs: 60 * 1000, // 1 minute
    max: 20,
    description: "Moderate operations (update, sync)",
  },
};

// =============================================================================
// HTTP Headers
// =============================================================================

/**
 * Get standard request headers
 * @param {string} [token] - Optional auth token
 * @returns {Object} Headers object
 */
export function getHeaders(token) {
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "User-Agent": "k6-load-test/1.0",
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  return headers;
}

// =============================================================================
// Response Validation
// =============================================================================

/**
 * Standard checks for API responses
 * @param {Object} response - k6 response object
 * @param {Object} [options] - Check options
 * @returns {Object} Check results
 */
export function standardChecks(response, options = {}) {
  const {
    expectedStatus = 200,
    allowRateLimit = true,
    checkBody = true,
  } = options;

  const checks = {};

  // Status check (allow 429 if rate limiting is expected)
  if (allowRateLimit) {
    checks["status is expected or rate limited"] =
      response.status === expectedStatus || response.status === 429;
  } else {
    checks[`status is ${expectedStatus}`] = response.status === expectedStatus;
  }

  // Rate limit detection
  checks["rate limit hit"] = response.status === 429;

  // Response time check
  checks["response time < 2000ms"] = response.timings.duration < 2000;

  // Body check for successful responses
  if (checkBody && response.status >= 200 && response.status < 300) {
    checks["has response body"] = response.body && response.body.length > 0;
  }

  return checks;
}

/**
 * Parse rate limit headers from response
 * @param {Object} response - k6 response object
 * @returns {Object|null} Rate limit info or null
 */
export function parseRateLimitHeaders(response) {
  const limit = response.headers["X-Ratelimit-Limit"];
  const remaining = response.headers["X-Ratelimit-Remaining"];
  const reset = response.headers["X-Ratelimit-Reset"];

  if (!limit) return null;

  return {
    limit: parseInt(limit),
    remaining: parseInt(remaining),
    resetAt: new Date(parseInt(reset) * 1000),
  };
}

// =============================================================================
// Logging Utilities
// =============================================================================

/**
 * Log rate limit status
 * @param {Object} response - k6 response object
 * @param {string} endpoint - Endpoint name
 */
export function logRateLimitStatus(response, endpoint) {
  const rateLimit = parseRateLimitHeaders(response);

  if (rateLimit) {
    if (rateLimit.remaining <= 2) {
      console.warn(
        `[${endpoint}] Rate limit warning: ${rateLimit.remaining}/${rateLimit.limit} remaining`
      );
    }

    if (response.status === 429) {
      console.error(
        `[${endpoint}] Rate limit exceeded! Reset at: ${rateLimit.resetAt.toISOString()}`
      );
    }
  }
}

// =============================================================================
// Common Thresholds
// =============================================================================

/**
 * Standard thresholds for load tests
 */
export const standardThresholds = {
  // 95% of requests should complete within 500ms
  http_req_duration: ["p(95)<500", "p(99)<1000"],
  // Less than 10% of requests should fail (excluding expected 429s)
  http_req_failed: ["rate<0.1"],
  // Custom metrics
  "rate_limits_hit": ["count<50"], // Alert if too many rate limits hit
};

/**
 * Relaxed thresholds for rate limit testing (expect some 429s)
 */
export const rateLimitTestThresholds = {
  http_req_duration: ["p(95)<1000", "p(99)<2000"],
  // Allow higher failure rate when testing rate limits
  http_req_failed: ["rate<0.5"],
};

// =============================================================================
// Scenario Stages Presets
// =============================================================================

/**
 * Gentle ramp-up for rate limit testing
 */
export const gentleStages = [
  { duration: "10s", target: 2 }, // Warm up
  { duration: "30s", target: 5 }, // Light load
  { duration: "20s", target: 2 }, // Cool down
  { duration: "10s", target: 0 }, // Ramp down
];

/**
 * Standard load test stages
 */
export const standardStages = [
  { duration: "30s", target: 10 }, // Ramp up
  { duration: "1m", target: 10 }, // Steady state
  { duration: "30s", target: 20 }, // Peak load
  { duration: "30s", target: 10 }, // Back to steady
  { duration: "10s", target: 0 }, // Ramp down
];

/**
 * Spike test stages
 */
export const spikeStages = [
  { duration: "10s", target: 5 }, // Warm up
  { duration: "10s", target: 50 }, // Spike!
  { duration: "30s", target: 50 }, // Hold spike
  { duration: "10s", target: 5 }, // Recovery
  { duration: "10s", target: 0 }, // Ramp down
];

/**
 * Stress test stages
 */
export const stressStages = [
  { duration: "2m", target: 10 }, // Ramp up
  { duration: "5m", target: 10 }, // Stay at 10 users
  { duration: "2m", target: 20 }, // Scale up
  { duration: "5m", target: 20 }, // Stay at 20 users
  { duration: "2m", target: 30 }, // Scale up
  { duration: "5m", target: 30 }, // Stay at 30 users
  { duration: "2m", target: 0 }, // Ramp down
];

// =============================================================================
// Test Data Generators
// =============================================================================

/**
 * Generate a unique test identifier
 * @returns {string} Unique ID
 */
export function uniqueId() {
  return `k6_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Generate test app data
 * @returns {Object} App creation payload
 */
export function generateTestApp() {
  const id = uniqueId();
  return {
    name: `loadtest-app-${id}`,
    image: "nginx:latest",
    port: 80,
    replicas: 1,
    env: {
      NODE_ENV: "test",
      K6_TEST_ID: id,
    },
  };
}

/**
 * Generate test cluster data
 * @returns {Object} Cluster creation payload
 */
export function generateTestCluster() {
  const id = uniqueId();
  return {
    name: `loadtest-cluster-${id}`,
    masterHost: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
    masterUser: "root",
  };
}

// =============================================================================
// Sleep Helpers
// =============================================================================

/**
 * Random sleep between min and max seconds
 * @param {number} min - Minimum seconds
 * @param {number} max - Maximum seconds
 * @returns {number} Sleep duration used
 */
export function randomSleep(min = 0.5, max = 2) {
  const duration = min + Math.random() * (max - min);
  return duration;
}

/**
 * Sleep to respect rate limits
 * Calculates sleep time based on rate limit config
 * @param {Object} rateLimit - Rate limit config from rateLimits
 * @param {number} [safetyFactor=0.8] - Stay below limit by this factor
 * @returns {number} Recommended sleep in seconds
 */
export function rateLimitSleep(rateLimit, safetyFactor = 0.8) {
  const windowSec = rateLimit.windowMs / 1000;
  const effectiveMax = Math.floor(rateLimit.max * safetyFactor);
  return windowSec / effectiveMax;
}

// =============================================================================
// Export Default Config
// =============================================================================

export default {
  getEnvConfig,
  getHeaders,
  standardChecks,
  parseRateLimitHeaders,
  logRateLimitStatus,
  rateLimits,
  standardThresholds,
  rateLimitTestThresholds,
  gentleStages,
  standardStages,
  spikeStages,
  stressStages,
  uniqueId,
  generateTestApp,
  generateTestCluster,
  randomSleep,
  rateLimitSleep,
};
