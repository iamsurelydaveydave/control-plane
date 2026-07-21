/**
 * Auth Endpoints Load Test
 *
 * Tests authentication endpoints with strict rate limiting:
 * - POST /api/auth/login - 5 requests per 15 minutes
 * - GET /api/auth/me - General API rate limit (100/min)
 * - DELETE /api/auth/logout - General API rate limit (100/min)
 *
 * This test is designed to:
 * 1. Verify auth rate limits are enforced (expect 429s after 5 logins)
 * 2. Measure response times for auth operations
 * 3. Test the rate limit recovery behavior
 *
 * Usage:
 *   k6 run -e ENV=local scenarios/auth.js
 *   k6 run -e ENV=local -e TEST_EMAIL=admin@test.com -e TEST_PASSWORD=secret scenarios/auth.js
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import {
  getEnvConfig,
  getHeaders,
  standardChecks,
  logRateLimitStatus,
  rateLimits,
  rateLimitTestThresholds,
  gentleStages,
  randomSleep,
} from "../k6-config.js";

// =============================================================================
// Custom Metrics
// =============================================================================

const loginAttempts = new Counter("login_attempts");
const loginSuccess = new Counter("login_success");
const loginRateLimited = new Counter("login_rate_limited");
const loginDuration = new Trend("login_duration");
const meRequestDuration = new Trend("me_request_duration");
const authSuccessRate = new Rate("auth_success_rate");

// =============================================================================
// Test Configuration
// =============================================================================

const config = getEnvConfig();

export const options = {
  scenarios: {
    // Scenario 1: Test login rate limiting
    login_rate_limit_test: {
      executor: "per-vu-iterations",
      vus: 1,
      iterations: 10, // Try 10 logins to exceed the 5/15min limit
      maxDuration: "2m",
      tags: { scenario: "login_rate_limit" },
      exec: "testLoginRateLimit",
    },

    // Scenario 2: Normal auth flow after getting a token
    auth_flow: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: gentleStages,
      tags: { scenario: "auth_flow" },
      exec: "testAuthFlow",
      // Start after rate limit test
      startTime: "2m30s",
    },

    // Scenario 3: Concurrent me requests (should not hit rate limit easily)
    me_endpoint_load: {
      executor: "constant-arrival-rate",
      rate: 10, // 10 requests per second
      timeUnit: "1s",
      duration: "30s",
      preAllocatedVUs: 5,
      maxVUs: 10,
      tags: { scenario: "me_load" },
      exec: "testMeEndpoint",
      startTime: "5m",
    },
  },

  thresholds: {
    ...rateLimitTestThresholds,
    login_duration: ["p(95)<1000"],
    me_request_duration: ["p(95)<300"],
    login_rate_limited: ["count>=1"], // We EXPECT to hit rate limits
    auth_success_rate: ["rate>0.3"], // Lower threshold since we expect 429s
  },
};

// =============================================================================
// Shared State
// =============================================================================

// Store valid tokens for authenticated requests
// Note: In k6, this is per-VU, not truly shared
let authToken = null;

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test login rate limiting
 * Attempts multiple logins to trigger 429 responses
 */
export function testLoginRateLimit() {
  const url = `${config.baseUrl}/api/auth/login`;
  const payload = JSON.stringify({
    email: config.testEmail,
    password: config.testPassword,
  });

  loginAttempts.add(1);

  const response = http.post(url, payload, {
    headers: getHeaders(),
    tags: { name: "POST /api/auth/login" },
  });

  loginDuration.add(response.timings.duration);
  logRateLimitStatus(response, "login");

  const checks = check(response, {
    "login response received": (r) => r.status !== 0,
    "login succeeded or rate limited": (r) => r.status === 200 || r.status === 429,
    "rate limit headers present": (r) => r.headers["X-Ratelimit-Limit"] !== undefined,
  });

  if (response.status === 200) {
    loginSuccess.add(1);
    authSuccessRate.add(1);

    try {
      const body = JSON.parse(response.body);
      if (body.token) {
        authToken = body.token;
        console.log("Login successful, token acquired");
      }
    } catch (e) {
      console.warn("Could not parse login response");
    }
  } else if (response.status === 429) {
    loginRateLimited.add(1);
    authSuccessRate.add(0);
    console.log(`Rate limit hit on attempt ${__ITER + 1} - this is expected!`);
  } else {
    authSuccessRate.add(0);
    console.warn(`Unexpected status: ${response.status}`);
  }

  // Small sleep between attempts
  sleep(randomSleep(0.5, 1));
}

/**
 * Test normal auth flow: login -> me -> logout
 */
export function testAuthFlow() {
  const baseUrl = config.baseUrl;

  group("Auth Flow", () => {
    // Step 1: Login
    group("Login", () => {
      const loginUrl = `${baseUrl}/api/auth/login`;
      const loginPayload = JSON.stringify({
        email: config.testEmail,
        password: config.testPassword,
      });

      const loginRes = http.post(loginUrl, loginPayload, {
        headers: getHeaders(),
        tags: { name: "POST /api/auth/login" },
      });

      check(loginRes, standardChecks(loginRes, { allowRateLimit: true }));
      logRateLimitStatus(loginRes, "login");

      if (loginRes.status === 200) {
        try {
          const body = JSON.parse(loginRes.body);
          authToken = body.token;
        } catch (e) {
          // Token might be in different format
        }
      } else if (loginRes.status === 429) {
        // Rate limited - skip rest of flow
        console.log("Login rate limited, skipping flow");
        return;
      }

      sleep(randomSleep(0.3, 0.5));
    });

    // Step 2: Get current user (only if we have a token)
    if (authToken) {
      group("Get Me", () => {
        const meUrl = `${baseUrl}/api/auth/me`;
        const meRes = http.get(meUrl, {
          headers: getHeaders(authToken),
          tags: { name: "GET /api/auth/me" },
        });

        meRequestDuration.add(meRes.timings.duration);

        check(meRes, {
          "me status is 200": (r) => r.status === 200,
          "me returns user data": (r) => {
            if (r.status !== 200) return false;
            try {
              const body = JSON.parse(r.body);
              return body.email !== undefined || body.user?.email !== undefined;
            } catch (e) {
              return false;
            }
          },
        });

        logRateLimitStatus(meRes, "me");
        sleep(randomSleep(0.3, 0.5));
      });

      // Step 3: Logout
      group("Logout", () => {
        const logoutUrl = `${baseUrl}/api/auth/logout`;
        const logoutRes = http.del(logoutUrl, null, {
          headers: getHeaders(authToken),
          tags: { name: "DELETE /api/auth/logout" },
        });

        check(logoutRes, {
          "logout status is 200 or 204": (r) => r.status === 200 || r.status === 204,
        });

        logRateLimitStatus(logoutRes, "logout");
        authToken = null; // Clear token after logout
      });
    }
  });

  sleep(randomSleep(1, 2));
}

/**
 * Test /me endpoint under load
 * Uses a pre-configured API token if available
 */
export function testMeEndpoint() {
  const token = config.apiToken || authToken;

  if (!token) {
    console.warn("No auth token available, skipping me endpoint test");
    sleep(1);
    return;
  }

  const url = `${config.baseUrl}/api/auth/me`;
  const response = http.get(url, {
    headers: getHeaders(token),
    tags: { name: "GET /api/auth/me" },
  });

  meRequestDuration.add(response.timings.duration);

  check(response, {
    "me status is 200 or 401": (r) => r.status === 200 || r.status === 401,
    "response time < 500ms": (r) => r.timings.duration < 500,
  });

  logRateLimitStatus(response, "me");
}

// =============================================================================
// Default Export (for single-scenario runs)
// =============================================================================

export default function () {
  // Run all scenarios in sequence for simple runs
  testLoginRateLimit();
}

// =============================================================================
// Setup and Teardown
// =============================================================================

export function setup() {
  console.log("=".repeat(60));
  console.log("Auth Load Test Starting");
  console.log(`Environment: ${__ENV.ENV || "local"}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`Test Email: ${config.testEmail}`);
  console.log("=".repeat(60));
  console.log("");
  console.log("Rate Limits to Test:");
  console.log(`  - Auth (login/token): ${rateLimits.auth.max} per ${rateLimits.auth.windowMs / 1000}s`);
  console.log(`  - API (general): ${rateLimits.api.max} per ${rateLimits.api.windowMs / 1000}s`);
  console.log("");
  console.log("Expected behavior: Login attempts beyond 5 should return 429");
  console.log("=".repeat(60));

  // Verify API is reachable
  const healthCheck = http.get(`${config.baseUrl}/api/health`, {
    tags: { name: "Health Check" },
  });

  if (healthCheck.status !== 200) {
    console.error(`API health check failed: ${healthCheck.status}`);
    console.error("Make sure the API is running before starting load tests");
  }

  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log("");
  console.log("=".repeat(60));
  console.log("Auth Load Test Complete");
  console.log(`Total duration: ${duration.toFixed(2)}s`);
  console.log("=".repeat(60));
}
