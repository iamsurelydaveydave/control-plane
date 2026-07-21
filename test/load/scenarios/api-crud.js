/**
 * API CRUD Operations Load Test
 *
 * Tests standard CRUD operations with general API rate limit:
 * - 100 requests per minute (general API limit)
 *
 * Endpoints tested:
 * - GET /api/apps - List apps
 * - POST /api/apps - Create app
 * - GET /api/apps/:id - Get single app
 * - PATCH /api/apps/:id - Update app
 * - DELETE /api/apps/:id - Delete app
 * - GET /api/organizations - List organizations
 *
 * This test is designed to:
 * 1. Verify API rate limits are enforced under load
 * 2. Measure CRUD operation response times
 * 3. Test concurrent read/write patterns
 *
 * Usage:
 *   k6 run -e ENV=local -e API_TOKEN=xxx scenarios/api-crud.js
 *   k6 run -e ENV=staging -e API_TOKEN=xxx -e VUS=20 scenarios/api-crud.js
 */

import http from "k6/http";
import { check, sleep, group, fail } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import { SharedArray } from "k6/data";
import {
  getEnvConfig,
  getHeaders,
  standardChecks,
  logRateLimitStatus,
  rateLimits,
  standardThresholds,
  standardStages,
  uniqueId,
  generateTestApp,
  randomSleep,
  rateLimitSleep,
} from "../k6-config.js";

// =============================================================================
// Custom Metrics
// =============================================================================

const apiRequests = new Counter("api_requests_total");
const apiRateLimited = new Counter("api_rate_limited");
const createDuration = new Trend("crud_create_duration");
const readDuration = new Trend("crud_read_duration");
const updateDuration = new Trend("crud_update_duration");
const deleteDuration = new Trend("crud_delete_duration");
const listDuration = new Trend("crud_list_duration");
const successRate = new Rate("crud_success_rate");

// =============================================================================
// Test Configuration
// =============================================================================

const config = getEnvConfig();

export const options = {
  scenarios: {
    // Scenario 1: Read-heavy load (70% of traffic)
    read_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 7 },
        { duration: "1m", target: 7 },
        { duration: "20s", target: 14 },
        { duration: "1m", target: 14 },
        { duration: "20s", target: 0 },
      ],
      tags: { scenario: "read_load" },
      exec: "testReadOperations",
    },

    // Scenario 2: Write operations (30% of traffic)
    write_load: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "20s", target: 3 },
        { duration: "1m", target: 3 },
        { duration: "20s", target: 6 },
        { duration: "1m", target: 6 },
        { duration: "20s", target: 0 },
      ],
      tags: { scenario: "write_load" },
      exec: "testWriteOperations",
    },

    // Scenario 3: Full CRUD cycle
    crud_cycle: {
      executor: "constant-vus",
      vus: 2,
      duration: "2m",
      tags: { scenario: "crud_cycle" },
      exec: "testFullCrudCycle",
      startTime: "3m",
    },

    // Scenario 4: Rate limit stress test
    rate_limit_stress: {
      executor: "constant-arrival-rate",
      rate: 120, // Slightly above 100/min to trigger rate limiting
      timeUnit: "1m",
      duration: "1m",
      preAllocatedVUs: 10,
      maxVUs: 20,
      tags: { scenario: "rate_limit_stress" },
      exec: "testRateLimitStress",
      startTime: "5m30s",
    },
  },

  thresholds: {
    ...standardThresholds,
    crud_create_duration: ["p(95)<1000"],
    crud_read_duration: ["p(95)<300"],
    crud_update_duration: ["p(95)<500"],
    crud_delete_duration: ["p(95)<500"],
    crud_list_duration: ["p(95)<500"],
    crud_success_rate: ["rate>0.8"],
    api_rate_limited: ["count<100"], // Expect some rate limiting in stress test
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get auth headers with token
 */
function getAuthHeaders() {
  if (!config.apiToken) {
    console.warn("No API_TOKEN provided. Set -e API_TOKEN=xxx");
    return getHeaders();
  }
  return getHeaders(config.apiToken);
}

/**
 * Track API request metrics
 */
function trackRequest(response, operation) {
  apiRequests.add(1);

  if (response.status === 429) {
    apiRateLimited.add(1);
    successRate.add(0);
    logRateLimitStatus(response, operation);
    return false;
  }

  if (response.status >= 200 && response.status < 300) {
    successRate.add(1);
    return true;
  }

  successRate.add(0);
  return false;
}

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test read operations (list and get)
 */
export function testReadOperations() {
  const headers = getAuthHeaders();

  group("Read Operations", () => {
    // List apps
    group("List Apps", () => {
      const response = http.get(`${config.baseUrl}/api/apps`, {
        headers,
        tags: { name: "GET /api/apps" },
      });

      listDuration.add(response.timings.duration);
      trackRequest(response, "list apps");

      check(response, {
        "list apps status ok or rate limited": (r) =>
          r.status === 200 || r.status === 401 || r.status === 429,
        "list apps response time < 500ms": (r) => r.timings.duration < 500,
      });
    });

    sleep(randomSleep(0.2, 0.5));

    // List organizations
    group("List Organizations", () => {
      const response = http.get(`${config.baseUrl}/api/organizations`, {
        headers,
        tags: { name: "GET /api/organizations" },
      });

      listDuration.add(response.timings.duration);
      trackRequest(response, "list orgs");

      check(response, {
        "list orgs status ok or rate limited": (r) =>
          r.status === 200 || r.status === 401 || r.status === 429,
      });
    });
  });

  // Respect rate limits - sleep based on API limit
  const sleepTime = rateLimitSleep(rateLimits.api, 0.9);
  sleep(sleepTime);
}

/**
 * Test write operations (create, update)
 */
export function testWriteOperations() {
  const headers = getAuthHeaders();

  group("Write Operations", () => {
    // Create a test app
    const appData = generateTestApp();

    group("Create App", () => {
      const response = http.post(
        `${config.baseUrl}/api/apps`,
        JSON.stringify(appData),
        {
          headers,
          tags: { name: "POST /api/apps" },
        }
      );

      createDuration.add(response.timings.duration);
      const success = trackRequest(response, "create app");

      check(response, {
        "create app status ok or rate limited": (r) =>
          r.status === 201 || r.status === 200 || r.status === 400 || r.status === 401 || r.status === 429,
        "create app response time < 1000ms": (r) => r.timings.duration < 1000,
      });

      // If created successfully, try to clean up
      if (success && (response.status === 201 || response.status === 200)) {
        try {
          const body = JSON.parse(response.body);
          const appId = body._id || body.id;

          if (appId) {
            sleep(randomSleep(0.1, 0.3));

            // Update the app
            group("Update App", () => {
              const updateRes = http.patch(
                `${config.baseUrl}/api/apps/${appId}`,
                JSON.stringify({ replicas: 2 }),
                {
                  headers,
                  tags: { name: "PATCH /api/apps/:id" },
                }
              );

              updateDuration.add(updateRes.timings.duration);
              trackRequest(updateRes, "update app");

              check(updateRes, {
                "update app status ok": (r) =>
                  r.status === 200 || r.status === 401 || r.status === 429,
              });
            });

            sleep(randomSleep(0.1, 0.3));

            // Delete the app (cleanup)
            group("Delete App", () => {
              const deleteRes = http.del(
                `${config.baseUrl}/api/apps/${appId}`,
                null,
                {
                  headers,
                  tags: { name: "DELETE /api/apps/:id" },
                }
              );

              deleteDuration.add(deleteRes.timings.duration);
              trackRequest(deleteRes, "delete app");

              check(deleteRes, {
                "delete app status ok": (r) =>
                  r.status === 200 || r.status === 204 || r.status === 401 || r.status === 429,
              });
            });
          }
        } catch (e) {
          // Ignore parse errors
        }
      }
    });
  });

  // Longer sleep for write operations
  sleep(randomSleep(1, 2));
}

/**
 * Test full CRUD cycle in sequence
 */
export function testFullCrudCycle() {
  const headers = getAuthHeaders();
  const appData = generateTestApp();
  let appId = null;

  group("Full CRUD Cycle", () => {
    // CREATE
    group("Create", () => {
      const response = http.post(
        `${config.baseUrl}/api/apps`,
        JSON.stringify(appData),
        {
          headers,
          tags: { name: "CRUD: Create" },
        }
      );

      createDuration.add(response.timings.duration);
      trackRequest(response, "crud:create");

      if (response.status === 201 || response.status === 200) {
        try {
          const body = JSON.parse(response.body);
          appId = body._id || body.id;
        } catch (e) {
          // Ignore
        }
      }

      check(response, {
        "create succeeded": (r) => r.status === 201 || r.status === 200 || r.status === 429,
      });
    });

    if (!appId) {
      console.log("Could not create app, skipping rest of CRUD cycle");
      sleep(1);
      return;
    }

    sleep(randomSleep(0.3, 0.5));

    // READ
    group("Read", () => {
      const response = http.get(`${config.baseUrl}/api/apps/${appId}`, {
        headers,
        tags: { name: "CRUD: Read" },
      });

      readDuration.add(response.timings.duration);
      trackRequest(response, "crud:read");

      check(response, {
        "read succeeded": (r) => r.status === 200 || r.status === 429,
        "read returns correct app": (r) => {
          if (r.status !== 200) return true; // Skip if rate limited
          try {
            const body = JSON.parse(r.body);
            return (body._id || body.id) === appId;
          } catch (e) {
            return false;
          }
        },
      });
    });

    sleep(randomSleep(0.3, 0.5));

    // UPDATE
    group("Update", () => {
      const response = http.patch(
        `${config.baseUrl}/api/apps/${appId}`,
        JSON.stringify({
          env: { ...appData.env, UPDATED: "true" },
        }),
        {
          headers,
          tags: { name: "CRUD: Update" },
        }
      );

      updateDuration.add(response.timings.duration);
      trackRequest(response, "crud:update");

      check(response, {
        "update succeeded": (r) => r.status === 200 || r.status === 429,
      });
    });

    sleep(randomSleep(0.3, 0.5));

    // DELETE
    group("Delete", () => {
      const response = http.del(`${config.baseUrl}/api/apps/${appId}`, null, {
        headers,
        tags: { name: "CRUD: Delete" },
      });

      deleteDuration.add(response.timings.duration);
      trackRequest(response, "crud:delete");

      check(response, {
        "delete succeeded": (r) => r.status === 200 || r.status === 204 || r.status === 429,
      });
    });
  });

  // Allow cleanup time before next cycle
  sleep(randomSleep(2, 3));
}

/**
 * Stress test to trigger rate limiting
 */
export function testRateLimitStress() {
  const headers = getAuthHeaders();

  // Simple read request to stress the rate limiter
  const response = http.get(`${config.baseUrl}/api/apps`, {
    headers,
    tags: { name: "Rate Limit Stress" },
  });

  apiRequests.add(1);
  trackRequest(response, "stress");

  check(response, {
    "response received": (r) => r.status !== 0,
    "expected response or rate limited": (r) =>
      r.status === 200 || r.status === 401 || r.status === 429,
  });

  // Log rate limit headers
  const remaining = response.headers["X-Ratelimit-Remaining"];
  if (remaining !== undefined && parseInt(remaining) < 10) {
    console.log(`Rate limit remaining: ${remaining}`);
  }

  // Minimal sleep - we want to stress the rate limiter
  sleep(0.1);
}

// =============================================================================
// Default Export
// =============================================================================

export default function () {
  // For simple runs, alternate between read and write operations
  if (__ITER % 3 === 0) {
    testWriteOperations();
  } else {
    testReadOperations();
  }
}

// =============================================================================
// Setup and Teardown
// =============================================================================

export function setup() {
  console.log("=".repeat(60));
  console.log("API CRUD Load Test Starting");
  console.log(`Environment: ${__ENV.ENV || "local"}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`API Token: ${config.apiToken ? "Provided" : "NOT PROVIDED"}`);
  console.log("=".repeat(60));
  console.log("");
  console.log("Rate Limit: " + rateLimits.api.max + " requests per " + rateLimits.api.windowMs / 1000 + "s");
  console.log("");

  if (!config.apiToken) {
    console.warn("WARNING: No API_TOKEN provided. Most endpoints will return 401.");
    console.warn("Run with: k6 run -e API_TOKEN=xxx scenarios/api-crud.js");
  }

  // Health check
  const healthCheck = http.get(`${config.baseUrl}/api/health`, {
    tags: { name: "Health Check" },
  });

  if (healthCheck.status !== 200) {
    console.error(`API health check failed: ${healthCheck.status}`);
  }

  return { startTime: Date.now() };
}

export function teardown(data) {
  const duration = (Date.now() - data.startTime) / 1000;
  console.log("");
  console.log("=".repeat(60));
  console.log("API CRUD Load Test Complete");
  console.log(`Total duration: ${duration.toFixed(2)}s`);
  console.log("=".repeat(60));
}
