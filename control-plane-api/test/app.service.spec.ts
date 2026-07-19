import { expect } from "chai";
import { describe, it, beforeEach, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useAppRepo } from "../src/resources/app/app.repository";
import { useServerRepo } from "../src/resources/server/server.repository";
import { useInstanceRepo } from "../src/resources/instance/instance.repository";
import { useAppService } from "../src/resources/app/app.service";
import { TApp } from "../src/resources/app/app.model";

describe("App Service", function () {
  // These are full integration tests that require:
  // - MongoDB (connected via root hooks)
  // - SSH key in DB (to connect to servers)
  // Skip if no SSH key is available
  this.timeout(15000);

  // Lazy initialization - these are created in beforeEach
  let appRepo: ReturnType<typeof useAppRepo>;
  let serverRepo: ReturnType<typeof useServerRepo>;
  let instanceRepo: ReturnType<typeof useInstanceRepo>;
  let appService: ReturnType<typeof useAppService>;

  let testAppId: ObjectId;
  let testServerId: ObjectId;

  // Create test server and app before each test
  beforeEach(async () => {
    // Initialize repos after DB connection is established
    appRepo = useAppRepo();
    serverRepo = useServerRepo();
    instanceRepo = useInstanceRepo();
    appService = useAppService();

    // Create a test server
    testServerId = await serverRepo.add({
      name: `test-server-${Date.now()}`,
      host: `192.168.1.${Math.floor(Math.random() * 255)}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["test"],
    });

    // Create a test app (using new model with source)
    const appName = `ta-${Math.random().toString(36).slice(2, 10)}`;
    testAppId = await appRepo.add({
      name: appName,
      source: {
        type: "image",
        image: "nginx:alpine",
      },
      serverIds: [testServerId.toString()] as any,
      env: { NODE_ENV: "test" },
      secretNames: [],
    } as any);
  });

  // Clean up after each test
  afterEach(async () => {
    // Delete instances
    if (testAppId) {
      await instanceRepo.deleteByAppId(testAppId);
    }

    // Delete app
    if (testAppId) {
      try {
        await appRepo.deleteById(testAppId);
      } catch {
        // Ignore if already deleted
      }
    }

    // Delete server
    if (testServerId) {
      try {
        await serverRepo.deleteById(testServerId);
      } catch {
        // Ignore if already deleted
      }
    }
  });

  describe("Deploy", () => {
    it("should update app status to deploying then running/failed", async () => {
      const result = await appService.deploy(testAppId);

      expect(result).to.exist;
      expect(result.message).to.include("Deployed");
      expect(result.instances).to.be.an("array");

      // Check app status is either running or failed (depends on SSH)
      const app = await appRepo.getById(testAppId);
      expect(app?.status).to.be.oneOf(["running", "failed"]);
    });

    it("should create instances for the app (one per server)", async () => {
      await appService.deploy(testAppId);

      const instances = await instanceRepo.getByAppId(testAppId);
      // In Kamal-style: one instance per server
      expect(instances).to.have.lengthOf(1);
    });

    it("should return errors when deployment fails", async () => {
      // Deploy will fail because no SSH key is available
      const result = await appService.deploy(testAppId);

      expect(result.errors).to.be.an("array");
      // Errors expected since no SSH key
      expect(result.errors.length).to.be.greaterThan(0);
    });

    it("should throw NotFoundError for non-existent app", async () => {
      const fakeId = new ObjectId();

      try {
        await appService.deploy(fakeId);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });

    it("should allow updating version during deploy", async () => {
      const newVersion = "1.25.0";
      await appService.deploy(testAppId, { version: newVersion });

      const app = await appRepo.getById(testAppId);
      expect(app?.currentVersion).to.equal(newVersion);
    });
  });

  describe("Restart", () => {
    it("should restart all instances", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Then restart
      const result = await appService.restart(testAppId);

      expect(result.message).to.include("Restarted");
      expect(result.errors).to.be.an("array");
    });

    it("should throw NotFoundError for non-existent app", async () => {
      const fakeId = new ObjectId();

      try {
        await appService.restart(fakeId);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });
  });

  describe("Stop", () => {
    it("should update app status to stopped", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Then stop
      const result = await appService.stop(testAppId);

      expect(result.message).to.include("Stopped");

      const app = await appRepo.getById(testAppId);
      expect(app?.status).to.equal("stopped");
    });

    it("should update all instance statuses to stopped", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Then stop
      await appService.stop(testAppId);

      const instances = await instanceRepo.getByAppId(testAppId);
      instances.forEach((instance) => {
        expect(instance.status).to.equal("stopped");
      });
    });

    it("should throw NotFoundError for non-existent app", async () => {
      const fakeId = new ObjectId();

      try {
        await appService.stop(fakeId);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });
  });

  describe("Delete", () => {
    it("should delete the app and all instances", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Then delete
      const result = await appService.deleteApp(testAppId);

      expect(result.message).to.include("Deleted");

      // Verify app is deleted
      const app = await appRepo.getById(testAppId);
      expect(app).to.be.null;

      // Verify instances are deleted
      const instances = await instanceRepo.getByAppId(testAppId);
      expect(instances).to.have.lengthOf(0);

      // Clear testAppId so afterEach doesn't try to delete again
      testAppId = null as any;
    });

    it("should throw NotFoundError for non-existent app", async () => {
      const fakeId = new ObjectId();

      try {
        await appService.deleteApp(fakeId);
        expect.fail("Should have thrown an error");
      } catch (error: any) {
        expect(error.message).to.include("not found");
      }
    });
  });

  describe("Instance Health Management", () => {
    it("should mark instance as unhealthy", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Get instance
      const instances = await instanceRepo.getByAppId(testAppId);
      expect(instances.length).to.be.greaterThan(0);

      const instanceId = instances[0]._id!;

      // Mark as unhealthy
      await appService.markInstanceUnhealthy(instanceId);

      // Verify
      const updated = await instanceRepo.getById(instanceId);
      expect(updated?.status).to.equal("unhealthy");
    });

    it("should mark instance as healthy", async () => {
      // First deploy
      await appService.deploy(testAppId);

      // Get instance
      const instances = await instanceRepo.getByAppId(testAppId);
      const instanceId = instances[0]._id!;

      // Mark as unhealthy first
      await appService.markInstanceUnhealthy(instanceId);

      // Then mark as healthy
      await appService.markInstanceHealthy(instanceId);

      // Verify
      const updated = await instanceRepo.getById(instanceId);
      expect(updated?.status).to.equal("running");
    });

    it("should handle non-existent instance gracefully", async () => {
      const fakeId = new ObjectId();

      // Should not throw
      await appService.markInstanceUnhealthy(fakeId);
      await appService.markInstanceHealthy(fakeId);
    });
  });

  describe("Rebuild All Routes", () => {
    it("should not throw with no running apps", async () => {
      // Stop the app first
      await appService.stop(testAppId);

      // Should not throw
      await appService.rebuildAllRoutes();
    });

    it("should rebuild routes for running apps", async () => {
      // Deploy the app
      await appService.deploy(testAppId);

      // Rebuild routes
      await appService.rebuildAllRoutes();

      // No assertion needed - just verify it doesn't throw
    });
  });
});

describe("App Service - Multi-Server Deployment", function () {
  this.timeout(15000);

  // Lazy initialization
  let appRepo: ReturnType<typeof useAppRepo>;
  let serverRepo: ReturnType<typeof useServerRepo>;
  let instanceRepo: ReturnType<typeof useInstanceRepo>;
  let appService: ReturnType<typeof useAppService>;

  let testAppId: ObjectId;
  let testServerId1: ObjectId;
  let testServerId2: ObjectId;
  let testServerId3: ObjectId;

  beforeEach(async () => {
    // Initialize repos after DB connection is established
    appRepo = useAppRepo();
    serverRepo = useServerRepo();
    instanceRepo = useInstanceRepo();
    appService = useAppService();

    // Create multiple test servers
    testServerId1 = await serverRepo.add({
      name: `test-server-1-${Date.now()}`,
      host: `192.168.1.${Math.floor(Math.random() * 100)}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["test"],
    });

    testServerId2 = await serverRepo.add({
      name: `test-server-2-${Date.now()}`,
      host: `192.168.1.${Math.floor(Math.random() * 100) + 100}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["test"],
    });

    testServerId3 = await serverRepo.add({
      name: `test-server-3-${Date.now()}`,
      host: `192.168.2.${Math.floor(Math.random() * 100)}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["test"],
    });

    // Create a test app with multiple servers (Kamal-style: one instance per server)
    const appName = `ma-${Math.random().toString(36).slice(2, 10)}`;
    testAppId = await appRepo.add({
      name: appName,
      source: {
        type: "image",
        image: "nginx:alpine",
      },
      serverIds: [testServerId1.toString(), testServerId2.toString(), testServerId3.toString()] as any,
      env: { NODE_ENV: "test" },
      secretNames: [],
      proxy: {
        ssl: true,
        host: "multi.example.com",
        appPort: 3000,
      },
    } as any);
  });

  afterEach(async () => {
    // Clean up
    if (testAppId) {
      await instanceRepo.deleteByAppId(testAppId);
      try {
        await appRepo.deleteById(testAppId);
      } catch {}
    }

    for (const serverId of [testServerId1, testServerId2, testServerId3]) {
      if (serverId) {
        try {
          await serverRepo.deleteById(serverId);
        } catch {}
      }
    }
  });

  it("should create one instance per server (Kamal-style)", async () => {
    await appService.deploy(testAppId);

    const instances = await instanceRepo.getByAppId(testAppId);

    // Should have 3 instances (one per server)
    expect(instances).to.have.lengthOf(3);

    // Should be distributed across all 3 servers
    const serverIds = new Set(instances.map((i) => i.serverId.toString()));
    expect(serverIds.size).to.equal(3);
  });

  it("should add instances when servers are added to app", async () => {
    // Deploy to initial servers
    await appService.deploy(testAppId);

    // Add a new server
    const newServerId = await serverRepo.add({
      name: `test-server-4-${Date.now()}`,
      host: `192.168.3.${Math.floor(Math.random() * 100)}`,
      sshUser: "root",
      sshPort: 22,
      tags: ["test"],
    });

    // Update app to include new server
    await appRepo.updateById(testAppId, {
      serverIds: [testServerId1, testServerId2, testServerId3, newServerId],
    });

    // Redeploy
    await appService.deploy(testAppId);

    const instances = await instanceRepo.getByAppId(testAppId);
    expect(instances).to.have.lengthOf(4);

    // Clean up new server
    await serverRepo.deleteById(newServerId);
  });

  it("should remove instances when servers are removed from app", async () => {
    // Deploy to all 3 servers
    await appService.deploy(testAppId);

    // Update app to only use 1 server
    await appRepo.updateById(testAppId, {
      serverIds: [testServerId1],
    });

    // Redeploy
    await appService.deploy(testAppId);

    const instances = await instanceRepo.getByAppId(testAppId);
    expect(instances).to.have.lengthOf(1);
    expect(instances[0].serverId.toString()).to.equal(testServerId1.toString());
  });
});
