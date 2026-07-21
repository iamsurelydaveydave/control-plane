/**
 * Heavy Operations Load Test
 *
 * Tests resource-intensive operations with strict rate limiting:
 * - 10 heavy operations per minute (deploy, create cluster, etc.)
 * - 20 moderate operations per minute (sync, update)
 *
 * Endpoints tested:
 * - POST /api/apps/:id/deploy - Deploy application (heavy)
 * - POST /api/apps/:id/redeploy - Redeploy application (heavy)
 * - POST /api/apps/:id/rollback - Rollback deployment (heavy)
 * - POST /api/clusters - Create cluster (heavy)
 * - DELETE /api/clusters/:id - Delete cluster (heavy)
 * - POST /api/clusters/:id/sync - Sync cluster status (moderate)
 *
 * This test is designed to:
 * 1. Verify heavy operation rate limits are enforced
 * 2. Measure response times for resource-intensive operations
 * 3. Test graceful handling of rate-limited requests
 *
 * Usage:
 *   k6 run -e ENV=local -e API_TOKEN=xxx scenarios/heavy-ops.js
 *   k6 run -e ENV=staging -e API_TOKEN=xxx scenarios/heavy-ops.js
 *
 * Note: This test creates test resources (apps, clusters) and attempts cleanup.
 *       Run with caution in non-test environments.
 */

import http from "k6/http";
import { check, sleep, group } from "k6";
import { Counter, Trend, Rate } from "k6/metrics";
import {
  getEnvConfig,
  getHeaders,
  logRateLimitStatus,
  rateLimits,
  rateLimitTestThresholds,
  uniqueId,
  generateTestApp,
  generateTestCluster,
  randomSleep,
  rateLimitSleep,
} from "../k6-config.js";

// =============================================================================
// Custom Metrics
// =============================================================================

const heavyOpsTotal = new Counter("heavy_ops_total");
const heavyOpsRateLimited = new Counter("heavy_ops_rate_limited");
const moderateOpsTotal = new Counter("moderate_ops_total");
const moderateOpsRateLimited = new Counter("moderate_ops_rate_limited");

const deployDuration = new Trend("deploy_duration");
const clusterCreateDuration = new Trend("cluster_create_duration");
const clusterSyncDuration = new Trend("cluster_sync_duration");

const heavyOpsSuccessRate = new Rate("heavy_ops_success_rate");
const moderateOpsSuccessRate = new Rate("moderate_ops_success_rate");

// =============================================================================
// Test Configuration
// =============================================================================

const config = getEnvConfig();

export const options = {
  scenarios: {
    // Scenario 1: Test heavy operation rate limiting
    heavy_rate_limit: {
      executor: "per-vu-iterations",
      vus: 2,
      iterations: 8, // Each VU does 8 iterations, should hit rate limit (10/min)
      maxDuration: "3m",
      tags: { scenario: "heavy_rate_limit" },
      exec: "testHeavyRateLimit",
    },

    // Scenario 2: Test moderate operation rate limiting
    moderate_rate_limit: {
      executor: "per-vu-iterations",
      vus: 2,
      iterations: 15, // Should hit moderate rate limit (20/min)
      maxDuration: "2m",
      tags: { scenario: "moderate_rate_limit" },
      exec: "testModerateRateLimit",
      startTime: "3m30s",
    },

    // Scenario 3: Mixed heavy/moderate operations
    mixed_operations: {
      executor: "ramping-vus",
      startVUs: 0,
      stages: [
        { duration: "30s", target: 2 },
        { duration: "1m", target: 2 },
        { duration: "30s", target: 0 },
      ],
      tags: { scenario: "mixed_ops" },
      exec: "testMixedOperations",
      startTime: "6m",
    },

    // Scenario 4: Sustained load below rate limits
    sustained_load: {
      executor: "constant-arrival-rate",
      rate: 5, // 5 per minute - well below the 10/min heavy limit
      timeUnit: "1m",
      duration: "2m",
      preAllocatedVUs: 2,
      maxVUs: 5,
      tags: { scenario: "sustained_load" },
      exec: "testSustainedLoad",
      startTime: "8m30s",
    },
  },

  thresholds: {
    ...rateLimitTestThresholds,
    deploy_duration: ["p(95)<5000"], // Deploy can take longer
    cluster_create_duration: ["p(95)<3000"],
    cluster_sync_duration: ["p(95)<2000"],
    heavy_ops_success_rate: ["rate>0.3"], // Lower threshold - we expect rate limiting
    moderate_ops_success_rate: ["rate>0.4"],
    heavy_ops_rate_limited: ["count>=1"], // We EXPECT to hit rate limits
  },
};

// =============================================================================
// Helper Functions
// =============================================================================

function getAuthHeaders() {
  if (!config.apiToken) {
    console.warn("No API_TOKEN provided. Set -e API_TOKEN=xxx");
    return getHeaders();
  }
  return getHeaders(config.apiToken);
}

/**
 * Track heavy operation metrics
 */
function trackHeavyOp(response, operation) {
  heavyOpsTotal.add(1);
  logRateLimitStatus(response, operation);

  if (response.status === 429) {
    heavyOpsRateLimited.add(1);
    heavyOpsSuccessRate.add(0);
    console.log(`[${operation}] Rate limited - this is expected behavior`);
    return false;
  }

  if (response.status >= 200 && response.status < 300) {
    heavyOpsSuccessRate.add(1);
    return true;
  }

  // 4xx/5xx but not rate limited
  heavyOpsSuccessRate.add(0);
  return false;
}

/**
 * Track moderate operation metrics
 */
function trackModerateOp(response, operation) {
  moderateOpsTotal.add(1);
  logRateLimitStatus(response, operation);

  if (response.status === 429) {
    moderateOpsRateLimited.add(1);
    moderateOpsSuccessRate.add(0);
    console.log(`[${operation}] Rate limited`);
    return false;
  }

  if (response.status >= 200 && response.status < 300) {
    moderateOpsSuccessRate.add(1);
    return true;
  }

  moderateOpsSuccessRate.add(0);
  return false;
}

/**
 * Create a test app and return its ID
 */
function createTestApp(headers) {
  const appData = generateTestApp();
  const response = http.post(
    `${config.baseUrl}/api/apps`,
    JSON.stringify(appData),
    { headers, tags: { name: "Setup: Create App" } }
  );

  if (response.status === 201 || response.status === 200) {
    try {
      const body = JSON.parse(response.body);
      return body._id || body.id;
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Delete a test app
 */
function deleteTestApp(headers, appId) {
  if (!appId) return;
  http.del(`${config.baseUrl}/api/apps/${appId}`, null, {
    headers,
    tags: { name: "Cleanup: Delete App" },
  });
}

// =============================================================================
// Test Functions
// =============================================================================

/**
 * Test heavy operation rate limiting
 * Attempts deploy operations to trigger 429
 */
export function testHeavyRateLimit() {
  const headers = getAuthHeaders();

  group("Heavy Operation Rate Limit Test", () => {
    // Create a test app first
    const appId = createTestApp(headers);

    if (!appId) {
      console.log("Could not create test app, simulating deploy request");
      // Use a fake ID - will get 404 but still counts against rate limit
      const fakeId = "000000000000000000000000";

      const response = http.post(
        `${config.baseUrl}/api/apps/${fakeId}/deploy`,
        JSON.stringify({ tag: "latest" }),
        {
          headers,
          tags: { name: "POST /api/apps/:id/deploy" },
        }
      );

      deployDuration.add(response.timings.duration);
      trackHeavyOp(response, "deploy (no app)");

      check(response, {
        "deploy response received": (r) => r.status !== 0,
        "deploy rate limited or error": (r) =>
          r.status === 429 || r.status === 404 || r.status === 401,
      });
    } else {
      // Attempt deploy on real app
      group("Deploy Operation", () => {
        const response = http.post(
          `${config.baseUrl}/api/apps/${appId}/deploy`,
          JSON.stringify({ tag: "latest" }),
          {
            headers,
            tags: { name: "POST /api/apps/:id/deploy" },
          }
        );

        deployDuration.add(response.timings.duration);
        trackHeavyOp(response, "deploy");

        check(response, {
          "deploy accepted or rate limited": (r) =>
            r.status === 200 || r.status === 202 || r.status === 400 || r.status === 429,
          "deploy response time reasonable": (r) => r.timings.duration < 10000,
        });
      });

      sleep(randomSleep(0.5, 1));

      // Attempt redeploy
      group("Redeploy Operation", () => {
        const response = http.post(
          `${config.baseUrl}/api/apps/${appId}/redeploy`,
          JSON.stringify({}),
          {
            headers,
            tags: { name: "POST /api/apps/:id/redeploy" },
          }
        );

        deployDuration.add(response.timings.duration);
        trackHeavyOp(response, "redeploy");

        check(response, {
          "redeploy accepted or rate limited": (r) =>
            r.status === 200 || r.status === 202 || r.status === 400 || r.status === 429,
        });
      });

      // Cleanup
      sleep(randomSleep(0.3, 0.5));
      deleteTestApp(headers, appId);
    }
  });

  // Short sleep between heavy operations
  sleep(randomSleep(1, 2));
}

/**
 * Test moderate operation rate limiting
 * Uses cluster sync as example of moderate operation
 */
export function testModerateRateLimit() {
  const headers = getAuthHeaders();

  group("Moderate Operation Rate Limit Test", () => {
    // First, list clusters to get an ID
    const listResponse = http.get(`${config.baseUrl}/api/clusters`, {
      headers,
      tags: { name: "GET /api/clusters" },
    });

    let clusterId = null;

    if (listResponse.status === 200) {
      try {
        const body = JSON.parse(listResponse.body);
        const clusters = body.data || body;
        if (Array.isArray(clusters) && clusters.length > 0) {
          clusterId = clusters[0]._id || clusters[0].id;
        }
      } catch (e) {
        // Ignore
      }
    }

    if (clusterId) {
      // Sync cluster status (moderate operation)
      group("Cluster Sync", () => {
        const response = http.post(
          `${config.baseUrl}/api/clusters/${clusterId}/sync`,
          JSON.stringify({}),
          {
            headers,
            tags: { name: "POST /api/clusters/:id/sync" },
          }
        );

        clusterSyncDuration.add(response.timings.duration);
        trackModerateOp(response, "cluster sync");

        check(response, {
          "sync accepted or rate limited": (r) =>
            r.status === 200 || r.status === 202 || r.status === 429,
        });
      });
    } else {
      // No cluster available, test with fake ID
      console.log("No cluster available, testing rate limit with fake ID");

      const fakeId = "000000000000000000000000";
      const response = http.post(
        `${config.baseUrl}/api/clusters/${fakeId}/sync`,
        JSON.stringify({}),
        {
          headers,
          tags: { name: "POST /api/clusters/:id/sync" },
        }
      );

      clusterSyncDuration.add(response.timings.duration);
      trackModerateOp(response, "cluster sync (no cluster)");

      check(response, {
        "response received": (r) => r.status !== 0,
      });
    }
  });

  // Sleep to respect moderate rate limit
  sleep(randomSleep(0.5, 1));
}

/**
 * Test mixed heavy and moderate operations
 */
export function testMixedOperations() {
  const headers = getAuthHeaders();

  group("Mixed Operations", () => {
    // Alternate between heavy and moderate operations
    if (__ITER % 2 === 0) {
      // Heavy: Create cluster
      group("Create Cluster (Heavy)", () => {
        const clusterData = generateTestCluster();
        const response = http.post(
          `${config.baseUrl}/api/clusters`,
          JSON.stringify(clusterData),
          {
            headers,
            tags: { name: "POST /api/clusters" },
          }
        );

        clusterCreateDuration.add(response.timings.duration);
        trackHeavyOp(response, "create cluster");

        check(response, {
          "cluster create response": (r) =>
            r.status === 201 || r.status === 200 || r.status === 400 || r.status === 429,
        });

        // Try to cleanup if created
        if (response.status === 201 || response.status === 200) {
          try {
            const body = JSON.parse(response.body);
            const clusterId = body._id || body.id;
            if (clusterId) {
              sleep(0.5);
              // Delete is also a heavy operation
              http.del(`${config.baseUrl}/api/clusters/${clusterId}`, null, {
                headers,
                tags: { name: "DELETE /api/clusters/:id" },
              });
            }
          } catch (e) {
            // Ignore
          }
        }
      });
    } else {
      // Moderate: Update cluster or app
      group("Update Operation (Moderate)", () => {
        // Try to get an existing app to update
        const listResponse = http.get(`${config.baseUrl}/api/apps`, {
          headers,
          tags: { name: "GET /api/apps (for update)" },
        });

        if (listResponse.status === 200) {
          try {
            const body = JSON.parse(listResponse.body);
            const apps = body.data || body;
            if (Array.isArray(apps) && apps.length > 0) {
              const appId = apps[0]._id || apps[0].id;

              const updateResponse = http.patch(
                `${config.baseUrl}/api/apps/${appId}`,
                JSON.stringify({ replicas: Math.floor(Math.random() * 3) + 1 }),
                {
                  headers,
                  tags: { name: "PATCH /api/apps/:id" },
                }
              );

              trackModerateOp(updateResponse, "update app");
            }
          } catch (e) {
            // Ignore
          }
        }
      });
    }
  });

  // Dynamic sleep based on operation type
  sleep(randomSleep(2, 4));
}

/**
 * Sustained load below rate limits
 * Verifies system handles consistent load without rate limiting
 */
export function testSustainedLoad() {
  const headers = getAuthHeaders();

  // Perform a heavy operation well below rate limit
  const fakeAppId = `sustained_${uniqueId()}`;

  const response = http.post(
    `${config.baseUrl}/api/apps/${fakeAppId}/deploy`,
    JSON.stringify({ tag: "latest" }),
    {
      headers,
      tags: { name: "Sustained Load: Deploy" },
    }
  );

  deployDuration.add(response.timings.duration);

  const wasRateLimited = response.status === 429;
  trackHeavyOp(response, "sustained deploy");

  check(response, {
    "sustained load not rate limited": (r) => r.status !== 429,
    "response in reasonable time": (r) => r.timings.duration < 5000,
  });

  if (wasRateLimited) {
    console.warn("Unexpected rate limit during sustained load test!");
  }

  // No additional sleep - rate is controlled by executor
}

// =============================================================================
// Default Export
// =============================================================================

export default function () {
  testHeavyRateLimit();
}

// =============================================================================
// Setup and Teardown
// =============================================================================

export function setup() {
  console.log("=".repeat(60));
  console.log("Heavy Operations Load Test Starting");
  console.log(`Environment: ${__ENV.ENV || "local"}`);
  console.log(`Base URL: ${config.baseUrl}`);
  console.log(`API Token: ${config.apiToken ? "Provided" : "NOT PROVIDED"}`);
  console.log("=".repeat(60));
  console.log("");
  console.log("Rate Limits:");
  console.log(`  - Heavy ops: ${rateLimits.heavy.max} per ${rateLimits.heavy.windowMs / 1000}s`);
  console.log(`  - Moderate ops: ${rateLimits.moderate.max} per ${rateLimits.moderate.windowMs / 1000}s`);
  console.log("");
  console.log("CAUTION: This test creates and deletes test resources!");
  console.log("=".repeat(60));

  if (!config.apiToken) {
    console.warn("");
    console.warn("WARNING: No API_TOKEN provided. Tests will likely fail with 401.");
    console.warn("Run with: k6 run -e API_TOKEN=xxx scenarios/heavy-ops.js");
    console.warn("");
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
  console.log("Heavy Operations Load Test Complete");
  console.log(`Total duration: ${duration.toFixed(2)}s`);
  console.log("=".repeat(60));
  console.log("");
  console.log("Summary:");
  console.log("- Check heavy_ops_rate_limited metric for rate limit hits");
  console.log("- Check deploy_duration for operation latencies");
  console.log("- Review any unexpected 5xx errors in the output");
}
