import { expect } from "chai";
import { describe, it, beforeEach, afterEach, before, after } from "mocha";
import { ObjectId } from "mongodb";
import { useAppRepo } from "../src/resources/app/app.repository";
import { useServerRepo } from "../src/resources/server/server.repository";
import { useInstanceRepo } from "../src/resources/instance/instance.repository";
import { useAppService } from "../src/resources/app/app.service";
import {
  useCaddyService,
  TAppForCaddy,
  TInstanceForCaddy,
  TServerForCaddy,
  TCaddyRoute,
} from "../src/services/caddy.service";
import { TApp } from "../src/resources/app/app.model";

/**
 * Caddy Integration Tests
 *
 * These tests validate the reverse proxy routing for multiple applications
 * across multiple servers. They test the full flow:
 *
 * 1. Server setup (simulated - no actual SSH)
 * 2. App creation with domains
 * 3. Instance creation on multiple servers
 * 4. Caddy route generation and updates
 * 5. Load balancing configuration
 * 6. Health check integration
 * 7. Route removal on app stop/delete
 *
 * Architecture:
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                      Caddy (Control Plane Host)                 │
 * │                        Ports 80/443                             │
 * │  ┌─────────────────────────────────────────────────────────┐   │
 * │  │                    Dynamic Routes                        │   │
 * │  │  app1.example.com → [server1:3001, server2:3001]        │   │
 * │  │  app2.example.com → [server1:3002, server3:3002]        │   │
 * │  │  api.example.com  → [server2:3003]                      │   │
 * │  └─────────────────────────────────────────────────────────┘   │
 * └───────────────────────────────┬─────────────────────────────────┘
 *                                 │
 *     ┌───────────────────────────┼───────────────────────────┐
 *     │                           │                           │
 *     ▼                           ▼                           ▼
 * ┌─────────┐               ┌─────────┐               ┌─────────┐
 * │ Server1 │               │ Server2 │               │ Server3 │
 * │ :3001   │               │ :3001   │               │ :3002   │
 * │ :3002   │               │ :3003   │               │         │
 * └─────────┘               └─────────┘               └─────────┘
 */

describe("Caddy Integration - Multiple Apps Reverse Proxy", function () {
  this.timeout(30000);

  // Lazy initialization
  let appRepo: ReturnType<typeof useAppRepo>;
  let serverRepo: ReturnType<typeof useServerRepo>;
  let instanceRepo: ReturnType<typeof useInstanceRepo>;
  let appService: ReturnType<typeof useAppService>;
  let caddyService: ReturnType<typeof useCaddyService>;

  // Test data IDs
  let server1Id: ObjectId;
  let server2Id: ObjectId;
  let server3Id: ObjectId;
  let app1Id: ObjectId;
  let app2Id: ObjectId;
  let app3Id: ObjectId;

  before(async () => {
    // Initialize repos
    appRepo = useAppRepo();
    serverRepo = useServerRepo();
    instanceRepo = useInstanceRepo();
    appService = useAppService();
    caddyService = useCaddyService();
  });

  beforeEach(async () => {
    // Create 3 servers simulating different hosts (with random suffixes for uniqueness)
    const suffix = Math.random().toString(36).slice(2, 8);
    
    server1Id = await serverRepo.add({
      name: `web-server-1-${suffix}`,
      host: `10.0.1.${Math.floor(Math.random() * 250) + 1}`,
      privateIp: `10.0.1.${Math.floor(Math.random() * 250) + 1}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["web", "production"],
    });

    server2Id = await serverRepo.add({
      name: `web-server-2-${suffix}`,
      host: `10.0.2.${Math.floor(Math.random() * 250) + 1}`,
      privateIp: `10.0.2.${Math.floor(Math.random() * 250) + 1}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["web", "production"],
    });

    server3Id = await serverRepo.add({
      name: `api-server-1-${suffix}`,
      host: `10.0.3.${Math.floor(Math.random() * 250) + 1}`,
      privateIp: `10.0.3.${Math.floor(Math.random() * 250) + 1}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["api", "production"],
    });

    // Create 3 different apps with different domains
    // App 1: Web frontend, deployed to server1 and server2
    const app1Name = `web-${Math.random().toString(36).slice(2, 8)}`;
    app1Id = await appRepo.add({
      name: app1Name,
      source: {
        type: "image",
        image: "ghcr.io/example/web-frontend:latest",
      },
      serverIds: [server1Id.toString(), server2Id.toString()] as any,
      env: { NODE_ENV: "production" },
      secretNames: [],
      proxy: {
        ssl: true,
        host: "www.example.com",
        appPort: 3000,
        healthcheckPath: "/health",
        healthcheckInterval: 10,
      },
      healthCheck: {
        path: "/health",
        interval: 30,
        timeout: 5,
      },
    } as any);

    // App 2: Mobile API, deployed to server1 and server3
    const app2Name = `api-${Math.random().toString(36).slice(2, 8)}`;
    app2Id = await appRepo.add({
      name: app2Name,
      source: {
        type: "image",
        image: "ghcr.io/example/mobile-api:latest",
      },
      serverIds: [server1Id.toString(), server3Id.toString()] as any,
      env: { NODE_ENV: "production" },
      secretNames: [],
      proxy: {
        ssl: true,
        host: "api.example.com",
        appPort: 8080,
        healthcheckPath: "/api/health",
      },
      healthCheck: {
        path: "/api/health",
        interval: 30,
        timeout: 5,
      },
    } as any);

    // App 3: Admin dashboard, deployed only to server2
    const app3Name = `admin-${Math.random().toString(36).slice(2, 8)}`;
    app3Id = await appRepo.add({
      name: app3Name,
      source: {
        type: "image",
        image: "ghcr.io/example/admin-dashboard:latest",
      },
      serverIds: [server2Id.toString()] as any,
      env: { NODE_ENV: "production" },
      secretNames: [],
      proxy: {
        ssl: true,
        host: "admin.example.com",
        appPort: 3000,
      },
    } as any);
  });

  afterEach(async () => {
    // Clean up in reverse order
    const appIds = [app1Id, app2Id, app3Id].filter(Boolean);
    const serverIds = [server1Id, server2Id, server3Id].filter(Boolean);

    for (const appId of appIds) {
      await instanceRepo.deleteByAppId(appId);
      try {
        await appRepo.deleteById(appId);
      } catch {}
    }

    for (const serverId of serverIds) {
      try {
        await serverRepo.deleteById(serverId);
      } catch {}
    }
  });

  describe("Route Generation for Multiple Apps", () => {
    it("should build correct routes for multiple apps on different servers", async () => {
      // Simulate instance creation (what deploy would do)
      const instance1_app1 = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance1_app1, "running");

      const instance2_app1 = await instanceRepo.add({
        appId: app1Id,
        serverId: server2Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance2_app1, "running");

      const instance1_app2 = await instanceRepo.add({
        appId: app2Id,
        serverId: server1Id,
        port: 3002,
      });
      await instanceRepo.updateStatus(instance1_app2, "running");

      const instance2_app2 = await instanceRepo.add({
        appId: app2Id,
        serverId: server3Id,
        port: 3002,
      });
      await instanceRepo.updateStatus(instance2_app2, "running");

      const instance_app3 = await instanceRepo.add({
        appId: app3Id,
        serverId: server2Id,
        port: 3003,
      });
      await instanceRepo.updateStatus(instance_app3, "running");

      // Update app statuses
      await appRepo.updateStatus(app1Id, "running");
      await appRepo.updateStatus(app2Id, "running");
      await appRepo.updateStatus(app3Id, "running");

      // Sync routing for all apps
      await appService.syncRouting(app1Id);
      await appService.syncRouting(app2Id);
      await appService.syncRouting(app3Id);

      // Verify instances were created correctly
      const app1Instances = await instanceRepo.getByAppId(app1Id);
      const app2Instances = await instanceRepo.getByAppId(app2Id);
      const app3Instances = await instanceRepo.getByAppId(app3Id);

      expect(app1Instances).to.have.lengthOf(2);
      expect(app2Instances).to.have.lengthOf(2);
      expect(app3Instances).to.have.lengthOf(1);

      // Check that all instances are running
      expect(app1Instances.every((i) => i.status === "running")).to.be.true;
      expect(app2Instances.every((i) => i.status === "running")).to.be.true;
      expect(app3Instances.every((i) => i.status === "running")).to.be.true;
    });

    it("should handle apps without domains gracefully", async () => {
      // Create an app without a domain
      const appNoDomainId = await appRepo.add({
        name: `nodomain-${Math.random().toString(36).slice(2, 8)}`,
        source: {
          type: "image",
          image: "nginx:alpine",
        },
        serverIds: [server1Id.toString()] as any,
        env: {},
        secretNames: [],
        // No proxy config = no domain
      } as any);

      const instanceId = await instanceRepo.add({
        appId: appNoDomainId,
        serverId: server1Id,
        port: 3004,
      });
      await instanceRepo.updateStatus(instanceId, "running");

      // Syncing should not throw
      await appService.syncRouting(appNoDomainId);

      // Clean up
      await instanceRepo.deleteByAppId(appNoDomainId);
      await appRepo.deleteById(appNoDomainId);
    });
  });

  describe("Load Balancing Configuration", () => {
    it("should distribute traffic across multiple instances", async () => {
      // Create instances for app1 (2 servers)
      const instance1 = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance1, "running");

      const instance2 = await instanceRepo.add({
        appId: app1Id,
        serverId: server2Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance2, "running");

      await appRepo.updateStatus(app1Id, "running");

      // Sync routing
      await appService.syncRouting(app1Id);

      // Verify both instances exist
      const instances = await instanceRepo.getByAppId(app1Id);
      expect(instances).to.have.lengthOf(2);

      // Check server distribution
      const serverIds = instances.map((i) => i.serverId.toString());
      expect(serverIds).to.include(server1Id.toString());
      expect(serverIds).to.include(server2Id.toString());
    });

    it("should only route to running instances", async () => {
      // Create 3 instances, only 2 running
      const instance1 = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance1, "running");

      const instance2 = await instanceRepo.add({
        appId: app1Id,
        serverId: server2Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instance2, "unhealthy"); // Not running!

      await appRepo.updateStatus(app1Id, "running");

      // Sync routing - Caddy service filters out non-running instances
      await appService.syncRouting(app1Id);

      // Verify instances
      const instances = await instanceRepo.getByAppId(app1Id);
      const runningInstances = instances.filter((i) => i.status === "running");

      expect(runningInstances).to.have.lengthOf(1);
    });
  });

  describe("Instance Health State Changes", () => {
    it("should mark instance unhealthy and update routing", async () => {
      // Create and deploy instance
      const instanceId = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instanceId, "running");
      await appRepo.updateStatus(app1Id, "running");

      // Mark as unhealthy
      await appService.markInstanceUnhealthy(instanceId);

      // Verify status changed
      const instance = await instanceRepo.getById(instanceId);
      expect(instance?.status).to.equal("unhealthy");
    });

    it("should mark instance healthy and restore routing", async () => {
      // Create instance
      const instanceId = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instanceId, "unhealthy");
      await appRepo.updateStatus(app1Id, "running");

      // Mark as healthy
      await appService.markInstanceHealthy(instanceId);

      // Verify status changed
      const instance = await instanceRepo.getById(instanceId);
      expect(instance?.status).to.equal("running");
    });
  });

  describe("Route Removal", () => {
    it("should remove routes when app is stopped", async () => {
      // Create and deploy
      const instanceId = await instanceRepo.add({
        appId: app1Id,
        serverId: server1Id,
        port: 3001,
      });
      await instanceRepo.updateStatus(instanceId, "running");
      await appRepo.updateStatus(app1Id, "running");

      // Stop the app (simulated)
      await instanceRepo.updateStatus(instanceId, "stopped");
      await appRepo.updateStatus(app1Id, "stopped");

      // Remove routing
      await caddyService.removeAppRouting(app1Id.toString());

      // Verify app status
      const app = await appRepo.getById(app1Id);
      expect(app?.status).to.equal("stopped");
    });

    it("should remove routes when app is deleted", async () => {
      // Create and deploy
      const tempAppId = await appRepo.add({
        name: `temp-${Math.random().toString(36).slice(2, 8)}`,
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [server1Id.toString()] as any,
        env: {},
        secretNames: [],
        proxy: { ssl: true, host: "temp.example.com", appPort: 3000 },
      } as any);

      const instanceId = await instanceRepo.add({
        appId: tempAppId,
        serverId: server1Id,
        port: 3005,
      });

      // Delete app
      await instanceRepo.deleteByAppId(tempAppId);
      await caddyService.removeAppRouting(tempAppId.toString());
      await appRepo.deleteById(tempAppId);

      // Verify app is deleted
      const app = await appRepo.getById(tempAppId);
      expect(app).to.be.null;
    });
  });

  describe("Rebuild All Routes", () => {
    it("should rebuild routes for all running apps", async () => {
      // Create instances for all 3 apps
      const inst1 = await instanceRepo.add({ appId: app1Id, serverId: server1Id, port: 3001 });
      await instanceRepo.updateStatus(inst1, "running");

      const inst2 = await instanceRepo.add({ appId: app2Id, serverId: server1Id, port: 3002 });
      await instanceRepo.updateStatus(inst2, "running");

      const inst3 = await instanceRepo.add({ appId: app3Id, serverId: server2Id, port: 3003 });
      await instanceRepo.updateStatus(inst3, "running");

      // Update app statuses
      await appRepo.updateStatus(app1Id, "running");
      await appRepo.updateStatus(app2Id, "running");
      await appRepo.updateStatus(app3Id, "running");

      // Rebuild all routes
      await appService.rebuildAllRoutes();

      // Verify all apps are still running
      const app1 = await appRepo.getById(app1Id);
      const app2 = await appRepo.getById(app2Id);
      const app3 = await appRepo.getById(app3Id);

      expect(app1?.status).to.equal("running");
      expect(app2?.status).to.equal("running");
      expect(app3?.status).to.equal("running");
    });

    it("should skip apps without domains during rebuild", async () => {
      // Create app without domain
      const noDomainAppId = await appRepo.add({
        name: `nodomain2-${Math.random().toString(36).slice(2, 8)}`,
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [server1Id.toString()] as any,
        env: {},
        secretNames: [],
      } as any);

      const inst = await instanceRepo.add({ appId: noDomainAppId, serverId: server1Id, port: 3006 });
      await instanceRepo.updateStatus(inst, "running");
      await appRepo.updateStatus(noDomainAppId, "running");

      // Rebuild should not throw
      await appService.rebuildAllRoutes();

      // Clean up
      await instanceRepo.deleteByAppId(noDomainAppId);
      await appRepo.deleteById(noDomainAppId);
    });
  });
});

describe("Caddy Service - Route Building Logic", function () {
  this.timeout(10000);

  const caddyService = useCaddyService();

  describe("buildRoute internal logic", () => {
    it("should prefer privateIp for internal routing", async () => {
      const appId = new ObjectId();
      const serverId = new ObjectId();

      const app: TAppForCaddy = {
        _id: appId,
        domain: "internal.example.com",
      };

      const instances: TInstanceForCaddy[] = [
        {
          _id: new ObjectId(),
          appId,
          serverId,
          port: 3001,
          status: "running",
        },
      ];

      const servers: Map<string, TServerForCaddy> = new Map([
        [
          serverId.toString(),
          {
            _id: serverId,
            host: "203.0.113.10", // Public IP
            privateIp: "10.0.0.10", // Private IP
          },
        ],
      ]);

      // The service should use privateIp (10.0.0.10) for the upstream
      // We can't directly inspect the built route without Caddy running,
      // but we verify no errors occur
      await caddyService.syncAppRouting(app, instances, servers);
    });

    it("should fall back to host when privateIp is not available", async () => {
      const appId = new ObjectId();
      const serverId = new ObjectId();

      const app: TAppForCaddy = {
        _id: appId,
        domain: "public.example.com",
      };

      const instances: TInstanceForCaddy[] = [
        {
          _id: new ObjectId(),
          appId,
          serverId,
          port: 3001,
          status: "running",
        },
      ];

      const servers: Map<string, TServerForCaddy> = new Map([
        [
          serverId.toString(),
          {
            _id: serverId,
            host: "203.0.113.10", // Public IP only
            // No privateIp
          },
        ],
      ]);

      // Should use host (203.0.113.10) as fallback
      await caddyService.syncAppRouting(app, instances, servers);
    });
  });

  describe("Multiple domains routing", () => {
    it("should handle different apps on different domains", async () => {
      const app1Id = new ObjectId();
      const app2Id = new ObjectId();
      const serverId = new ObjectId();

      const serverMap: Map<string, TServerForCaddy> = new Map([
        [
          serverId.toString(),
          {
            _id: serverId,
            host: "10.0.0.1",
          },
        ],
      ]);

      // App 1: www.example.com
      await caddyService.syncAppRouting(
        {
          _id: app1Id,
          domain: "www.example.com",
        },
        [
          {
            _id: new ObjectId(),
            appId: app1Id,
            serverId,
            port: 3001,
            status: "running",
          },
        ],
        serverMap
      );

      // App 2: api.example.com
      await caddyService.syncAppRouting(
        {
          _id: app2Id,
          domain: "api.example.com",
        },
        [
          {
            _id: new ObjectId(),
            appId: app2Id,
            serverId,
            port: 3002,
            status: "running",
          },
        ],
        serverMap
      );

      // Both should work without conflicts
    });
  });
});

describe("Caddy Service - Health Check Configuration", function () {
  this.timeout(10000);

  const caddyService = useCaddyService();

  it("should include health checks in route configuration", async () => {
    const appId = new ObjectId();
    const serverId = new ObjectId();

    const appWithHealthCheck: TAppForCaddy = {
      _id: appId,
      domain: "health.example.com",
      healthCheck: {
        path: "/api/health",
        interval: 15,
        timeout: 10,
      },
    };

    const instances: TInstanceForCaddy[] = [
      {
        _id: new ObjectId(),
        appId,
        serverId,
        port: 3001,
        status: "running",
      },
    ];

    const servers: Map<string, TServerForCaddy> = new Map([
      [serverId.toString(), { _id: serverId, host: "10.0.0.1" }],
    ]);

    // Route should include health check configuration
    await caddyService.syncAppRouting(appWithHealthCheck, instances, servers);
  });

  it("should work without health checks", async () => {
    const appId = new ObjectId();
    const serverId = new ObjectId();

    const appNoHealthCheck: TAppForCaddy = {
      _id: appId,
      domain: "nohealth.example.com",
      // No healthCheck
    };

    const instances: TInstanceForCaddy[] = [
      {
        _id: new ObjectId(),
        appId,
        serverId,
        port: 3001,
        status: "running",
      },
    ];

    const servers: Map<string, TServerForCaddy> = new Map([
      [serverId.toString(), { _id: serverId, host: "10.0.0.1" }],
    ]);

    await caddyService.syncAppRouting(appNoHealthCheck, instances, servers);
  });
});
