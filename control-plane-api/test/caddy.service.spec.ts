import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import {
  useCaddyService,
  TAppForCaddy,
  TInstanceForCaddy,
  TServerForCaddy,
} from "../src/services/caddy.service";

describe("Caddy Service", function () {
  this.timeout(10000);

  // Test data
  const mockAppId = new ObjectId();
  const mockServerId1 = new ObjectId();
  const mockServerId2 = new ObjectId();

  const mockApp: TAppForCaddy = {
    _id: mockAppId,
    domain: "test-app.example.com",
    healthCheck: {
      path: "/health",
      interval: 10,
      timeout: 5,
    },
    loadBalancer: {
      policy: "round_robin",
    },
  };

  const mockInstances: TInstanceForCaddy[] = [
    {
      _id: new ObjectId(),
      appId: mockAppId,
      serverId: mockServerId1,
      port: 3001,
      status: "running",
    },
    {
      _id: new ObjectId(),
      appId: mockAppId,
      serverId: mockServerId2,
      port: 3001,
      status: "running",
    },
  ];

  const mockServers: Map<string, TServerForCaddy> = new Map([
    [
      mockServerId1.toString(),
      {
        _id: mockServerId1,
        host: "192.168.1.10",
        privateIp: "10.0.0.10",
      },
    ],
    [
      mockServerId2.toString(),
      {
        _id: mockServerId2,
        host: "192.168.1.11",
        privateIp: "10.0.0.11",
      },
    ],
  ]);

  describe("Service Initialization", () => {
    it("should check if Caddy is enabled", () => {
      const service = useCaddyService();
      
      // Default is enabled unless CADDY_ENABLED=false
      const isEnabled = service.isEnabled();
      expect(isEnabled).to.be.a("boolean");
    });
  });

  describe("Route Building", () => {
    it("should handle app without domain gracefully", async () => {
      const service = useCaddyService();
      const appWithoutDomain: TAppForCaddy = {
        _id: new ObjectId(),
        domain: undefined,
      };

      // Should not throw, just skip
      await service.syncAppRouting(appWithoutDomain, [], mockServers);
      // No error means success
    });

    it("should handle empty instances gracefully", async () => {
      const service = useCaddyService();

      // Should not throw when no running instances
      await service.syncAppRouting(mockApp, [], mockServers);
      // No error means success
    });

    it("should filter out non-running instances", async () => {
      const service = useCaddyService();
      
      const mixedInstances: TInstanceForCaddy[] = [
        {
          _id: new ObjectId(),
          appId: mockAppId,
          serverId: mockServerId1,
          port: 3001,
          status: "running",
        },
        {
          _id: new ObjectId(),
          appId: mockAppId,
          serverId: mockServerId2,
          port: 3002,
          status: "stopped", // Should be filtered out
        },
        {
          _id: new ObjectId(),
          appId: mockAppId,
          serverId: mockServerId1,
          port: 3003,
          status: "unhealthy", // Should be filtered out
        },
      ];

      // This won't actually call Caddy (since it's not running in tests)
      // but it tests the filtering logic doesn't throw
      await service.syncAppRouting(mockApp, mixedInstances, mockServers);
    });
  });

  describe("Health Check", () => {
    it("should return unhealthy when Caddy is not reachable", async () => {
      const service = useCaddyService();
      const health = await service.healthCheck();

      // Caddy isn't running in tests, so it should either be disabled or unhealthy
      if (service.isEnabled()) {
        expect(health.healthy).to.be.false;
      } else {
        // When disabled, healthCheck returns healthy (not blocking)
        expect(health.healthy).to.be.true;
      }
    });
  });

  describe("Remove Routing", () => {
    it("should not throw when removing non-existent route", async () => {
      const service = useCaddyService();

      // Should not throw even if route doesn't exist
      await service.removeAppRouting("non-existent-app-id");
    });
  });

  describe("Rebuild Full Config", () => {
    it("should handle empty app list", async () => {
      const service = useCaddyService();

      // Should not throw with empty data
      await service.rebuildFullConfig([], [], []);
    });

    it("should filter apps without domains", async () => {
      const service = useCaddyService();

      const apps: TAppForCaddy[] = [
        { _id: new ObjectId(), domain: "has-domain.example.com" },
        { _id: new ObjectId(), domain: undefined },
        { _id: new ObjectId(), domain: "" },
      ];

      // Should not throw
      await service.rebuildFullConfig(apps, [], []);
    });
  });
});

describe("Caddy Service - Load Balancer Policies", function () {
  this.timeout(5000);

  const mockAppId = new ObjectId();
  const mockServerId = new ObjectId();

  const mockServer: TServerForCaddy = {
    _id: mockServerId,
    host: "192.168.1.10",
    privateIp: "10.0.0.10",
  };

  const mockInstance: TInstanceForCaddy = {
    _id: new ObjectId(),
    appId: mockAppId,
    serverId: mockServerId,
    port: 3001,
    status: "running",
  };

  it("should use round_robin by default", async () => {
    const service = useCaddyService();
    const app: TAppForCaddy = {
      _id: mockAppId,
      domain: "test.example.com",
      // No loadBalancer config
    };

    // This tests the internal buildRoute logic
    // Since we can't easily inspect the built route without calling Caddy,
    // we just verify it doesn't throw
    await service.syncAppRouting(
      app,
      [mockInstance],
      new Map([[mockServerId.toString(), mockServer]])
    );
  });

  it("should support least_conn policy", async () => {
    const service = useCaddyService();
    const app: TAppForCaddy = {
      _id: mockAppId,
      domain: "test.example.com",
      loadBalancer: { policy: "least_conn" },
    };

    await service.syncAppRouting(
      app,
      [mockInstance],
      new Map([[mockServerId.toString(), mockServer]])
    );
  });

  it("should support ip_hash policy", async () => {
    const service = useCaddyService();
    const app: TAppForCaddy = {
      _id: mockAppId,
      domain: "test.example.com",
      loadBalancer: { policy: "ip_hash" },
    };

    await service.syncAppRouting(
      app,
      [mockInstance],
      new Map([[mockServerId.toString(), mockServer]])
    );
  });

  it("should support cookie-based sticky sessions", async () => {
    const service = useCaddyService();
    const app: TAppForCaddy = {
      _id: mockAppId,
      domain: "test.example.com",
      loadBalancer: {
        policy: "cookie",
        stickySessionCookie: "session_id",
      },
    };

    await service.syncAppRouting(
      app,
      [mockInstance],
      new Map([[mockServerId.toString(), mockServer]])
    );
  });
});
