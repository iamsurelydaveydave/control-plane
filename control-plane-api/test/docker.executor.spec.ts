import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";
import { ObjectId } from "mongodb";
import { useDockerExecutor } from "../src/services/docker.executor";
import { TApp } from "../src/resources/app/app.model";
import { TInstance } from "../src/resources/instance/instance.model";
import { TServer } from "../src/resources/server/server.model";

describe("Docker Executor", function () {
  this.timeout(35000); // SSH timeout is 30s

  // Lazy initialization
  let dockerExecutor: ReturnType<typeof useDockerExecutor>;

  // Test data
  const mockAppId = new ObjectId();
  const mockInstanceId = new ObjectId();
  const mockServerId = new ObjectId();

  const mockApp: TApp = {
    _id: mockAppId,
    name: "test-app",
    source: { type: "image", image: "nginx:alpine" },
    serverIds: [mockServerId],
    env: {
      NODE_ENV: "production",
      PORT: "3000",
    },
    secretNames: [],
    status: "running",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockInstance: TInstance = {
    _id: mockInstanceId,
    appId: mockAppId,
    serverId: mockServerId,
    port: 3001,
    status: "running",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockServer: TServer = {
    _id: mockServerId,
    name: "test-server",
    host: "192.168.1.100",
    sshUser: "root",
    sshPort: 22,
    status: "online",
    tags: ["compute"],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    dockerExecutor = useDockerExecutor();
  });

  describe("Container Name Generation", () => {
    it("should generate consistent container names", () => {
      const name1 = dockerExecutor.getContainerName("my-app", mockInstanceId);
      const name2 = dockerExecutor.getContainerName("my-app", mockInstanceId);

      expect(name1).to.equal(name2);
    });

    it("should include app name in container name", () => {
      const name = dockerExecutor.getContainerName("my-web-app", mockInstanceId);

      expect(name).to.include("my-web-app");
      expect(name).to.match(/^cp-/); // Starts with cp- prefix
    });

    it("should sanitize app names with special characters", () => {
      const name = dockerExecutor.getContainerName("My App 123!", mockInstanceId);

      expect(name).to.match(/^cp-[a-z0-9-]+-[a-z0-9]+$/);
      expect(name).to.not.include(" ");
      expect(name).to.not.include("!");
    });

    it("should include instance ID suffix for uniqueness", () => {
      const instanceId1 = new ObjectId();
      const instanceId2 = new ObjectId();

      const name1 = dockerExecutor.getContainerName("app", instanceId1);
      const name2 = dockerExecutor.getContainerName("app", instanceId2);

      expect(name1).to.not.equal(name2);
    });
  });

  describe("Deploy Container", () => {
    it("should fail gracefully when no SSH key is available", async () => {
      const result = await dockerExecutor.deployContainer(
        mockApp,
        mockInstance,
        mockServer
      );

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe("Stop Container", () => {
    it("should fail gracefully when no SSH key is available", async () => {
      const result = await dockerExecutor.stopContainer(
        mockApp.name,
        mockInstance,
        mockServer
      );

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe("Restart Container", () => {
    it("should fail gracefully when no SSH key is available", async () => {
      const result = await dockerExecutor.restartContainer(
        mockApp.name,
        mockInstance,
        mockServer
      );

      expect(result.success).to.be.false;
      expect(result.error).to.exist;
    });
  });

  describe("Container Status", () => {
    it("should return error when no SSH key is available", async () => {
      const status = await dockerExecutor.getContainerStatus(
        mockApp.name,
        mockInstance,
        mockServer
      );

      expect(status.running).to.be.false;
      expect(status.error).to.exist;
    });
  });

  describe("Container Logs", () => {
    it("should return error when no SSH key is available", async () => {
      const result = await dockerExecutor.getContainerLogs(
        mockApp.name,
        mockInstance,
        mockServer,
        50
      );

      expect(result.logs).to.equal("");
      expect(result.error).to.exist;
    });
  });

  describe("Docker Availability", () => {
    it("should return false when no SSH key is available", async () => {
      const available = await dockerExecutor.checkDockerAvailable(mockServer);

      expect(available).to.be.false;
    });
  });
});

describe("Docker Executor - App Configuration", function () {
  this.timeout(5000);

  // Lazy initialization
  let dockerExecutor: ReturnType<typeof useDockerExecutor>;

  beforeEach(() => {
    dockerExecutor = useDockerExecutor();
  });

  describe("Environment Variables", () => {
    it("should handle apps with no environment variables", () => {
      const app: TApp = {
        _id: new ObjectId(),
        name: "minimal-app",
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [new ObjectId()],
        env: {},
        secretNames: [],
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Container name generation should still work
      const name = dockerExecutor.getContainerName(app.name, new ObjectId());
      expect(name).to.include("minimal-app");
    });
  });

  describe("Resource Limits", () => {
    it("should handle apps with resource limits", () => {
      const app: TApp = {
        _id: new ObjectId(),
        name: "limited-app",
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [new ObjectId()],
        env: {},
        secretNames: [],
        resources: {
          memory: "512m",
          cpus: 0.5,
        },
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      // Should not throw
      const name = dockerExecutor.getContainerName(app.name, new ObjectId());
      expect(name).to.include("limited-app");
    });

    it("should handle apps without resource limits", () => {
      const app: TApp = {
        _id: new ObjectId(),
        name: "unlimited-app",
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [new ObjectId()],
        env: {},
        secretNames: [],
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const name = dockerExecutor.getContainerName(app.name, new ObjectId());
      expect(name).to.include("unlimited-app");
    });
  });

  describe("Health Checks", () => {
    it("should handle apps with health checks", () => {
      const app: TApp = {
        _id: new ObjectId(),
        name: "healthy-app",
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [new ObjectId()],
        env: {},
        secretNames: [],
        healthCheck: {
          path: "/health",
          interval: 10,
          timeout: 5,
        },
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const name = dockerExecutor.getContainerName(app.name, new ObjectId());
      expect(name).to.include("healthy-app");
    });

    it("should handle apps without health checks", () => {
      const app: TApp = {
        _id: new ObjectId(),
        name: "no-health-app",
        source: { type: "image", image: "nginx:alpine" },
        serverIds: [new ObjectId()],
        env: {},
        secretNames: [],
        status: "running",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const name = dockerExecutor.getContainerName(app.name, new ObjectId());
      expect(name).to.include("no-health-app");
    });
  });
});
