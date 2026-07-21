import { expect } from "chai";
import { describe, it, afterEach, before } from "mocha";
import {
  useAddonRepo,
  modelAddon,
  TAddonType,
  TAddonStatus,
  ADDON_CATALOG,
  getAddonDefaultPort,
  isDatabaseType,
  isRedisType,
  addonTypes,
} from "../src/resources";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid addon payload. */
function makeAddonPayload(overrides: Record<string, unknown> = {}) {
  const randomSuffix = Math.random().toString(36).slice(2, 8);
  return {
    name: `test-addon-${randomSuffix}`,
    type: "redis" as TAddonType,
    namespace: "cp-addons-test",
    values: {},
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Addon Resource", function () {
  this.timeout(15000);

  let repo: ReturnType<typeof useAddonRepo>;
  const createdIds: string[] = [];
  let dbAvailable = true;

  before(async function () {
    // Probe database availability
    try {
      repo = useAddonRepo();
      await repo.createIndexes();
    } catch (error) {
      console.warn("MongoDB not available — skipping addon tests:", error);
      dbAvailable = false;
    }
  });

  afterEach(async function () {
    if (!dbAvailable) return;
    for (const id of createdIds) {
      try {
        await repo.deleteById(id);
      } catch {
        // Ignore — might have been deleted in the test itself
      }
    }
    createdIds.length = 0;
  });

  // -------------------------------------------------------------------------
  // Model validation
  // -------------------------------------------------------------------------

  describe("modelAddon()", function () {
    it("should build a valid addon document from a minimal payload", function () {
      const addon = modelAddon(makeAddonPayload());

      expect(addon.name).to.be.a("string");
      expect(addon.type).to.equal("redis");
      expect(addon.namespace).to.equal("cp-addons-test");
      expect(addon.status).to.equal("pending"); // always set on create
      expect(addon.releaseName).to.be.a("string");
      expect(addon.releaseName).to.include("test-addon-");
      expect(addon.version).to.equal(ADDON_CATALOG.redis.version);
      expect(addon.createdAt).to.be.instanceOf(Date);
    });

    it("should use catalog version when not specified", function () {
      for (const [type, catalog] of Object.entries(ADDON_CATALOG)) {
        const addon = modelAddon(makeAddonPayload({ type: type as TAddonType }));
        expect(addon.version).to.equal(catalog.version);
      }
    });

    it("should override version when specified", function () {
      const addon = modelAddon(makeAddonPayload({ version: "99.0.0" }));
      expect(addon.version).to.equal("99.0.0");
    });

    it("should merge default values with provided values", function () {
      const addon = modelAddon(makeAddonPayload({
        values: { custom: "value" },
      }));
      expect(addon.values).to.have.property("auth"); // from catalog defaults
      expect(addon.values).to.have.property("custom", "value");
    });

    it("should throw BadRequestError for missing required fields", function () {
      expect(() => modelAddon({ name: "incomplete" } as any)).to.throw(
        /Addon validation error/
      );
    });

    it("should throw BadRequestError for invalid addon type", function () {
      expect(() => modelAddon(makeAddonPayload({ type: "invalid" }))).to.throw(
        /Addon validation error/
      );
    });

    it("should throw BadRequestError for invalid name format", function () {
      expect(() => modelAddon(makeAddonPayload({ name: "Invalid_Name" }))).to.throw(
        /Addon validation error/
      );
      expect(() => modelAddon(makeAddonPayload({ name: "-invalid" }))).to.throw(
        /Addon validation error/
      );
    });

    it("should accept valid name formats", function () {
      expect(() => modelAddon(makeAddonPayload({ name: "a" }))).to.not.throw();
      expect(() => modelAddon(makeAddonPayload({ name: "redis-cache" }))).to.not.throw();
      expect(() => modelAddon(makeAddonPayload({ name: "my-app-123" }))).to.not.throw();
    });
  });

  // -------------------------------------------------------------------------
  // Repository CRUD
  // -------------------------------------------------------------------------

  describe("useAddonRepo() — CRUD", function () {
    it("should add and retrieve an addon by ID", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const addon = await repo.getById(insertedId);
      expect(addon).to.exist;
      expect(addon!.name).to.equal(payload.name);
      expect(addon!.type).to.equal("redis");
      expect(addon!.status).to.equal("pending");
    });

    it("should retrieve an addon by name", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const addon = await repo.getByName(payload.name);
      expect(addon).to.exist;
      expect(addon!._id!.toString()).to.equal(insertedId);
    });

    it("should retrieve an addon by release name", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const createdAddon = await repo.getById(insertedId);
      const addon = await repo.getByReleaseName(createdAddon!.releaseName);
      expect(addon).to.exist;
      expect(addon!._id!.toString()).to.equal(insertedId);
    });

    it("should return null for non-existent addon by ID", async function () {
      if (!dbAvailable) this.skip();

      const addon = await repo.getById("000000000000000000000000");
      expect(addon).to.be.null;
    });

    it("should update addon status", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      await repo.updateStatus(insertedId, "running");

      const addon = await repo.getById(insertedId);
      expect(addon!.status).to.equal("running");
    });

    it("should update addon status with error message", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      await repo.updateStatus(insertedId, "failed", "Deployment failed");

      const addon = await repo.getById(insertedId);
      expect(addon!.status).to.equal("failed");
      expect(addon!.lastError).to.equal("Deployment failed");
    });

    it("should update connection info", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      await repo.updateConnectionInfo(insertedId, {
        host: "redis.svc.cluster.local",
        port: 6379,
        password: "secret",
      });

      const addon = await repo.getById(insertedId);
      expect(addon!.connectionInfo).to.exist;
      expect(addon!.connectionInfo!.host).to.equal("redis.svc.cluster.local");
      expect(addon!.connectionInfo!.port).to.equal(6379);
    });

    it("should delete an addon", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);

      await repo.deleteById(insertedId);

      const addon = await repo.getById(insertedId);
      expect(addon).to.be.null;
    });

    it("should throw ConflictError for duplicate name", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      try {
        await repo.add({ ...payload, values: { different: true } });
        expect.fail("Should have thrown ConflictError");
      } catch (error: any) {
        expect(error.message).to.include("already exists");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Repository queries
  // -------------------------------------------------------------------------

  describe("useAddonRepo() — queries", function () {
    it("should list addons with pagination", async function () {
      if (!dbAvailable) this.skip();

      // Create several addons
      for (let i = 0; i < 3; i++) {
        const id = await repo.add(makeAddonPayload());
        createdIds.push(id);
      }

      const result = await repo.getAll({ page: 1, limit: 2, namespace: "cp-addons-test" });
      expect(result.items).to.have.lengthOf(2);
      expect(result.pages).to.be.at.least(2);
    });

    it("should filter addons by type", async function () {
      if (!dbAvailable) this.skip();

      const redisId = await repo.add(makeAddonPayload({ type: "redis" as TAddonType }));
      const pgId = await repo.add(makeAddonPayload({ type: "postgresql" as TAddonType }));
      createdIds.push(redisId, pgId);

      const result = await repo.getAll({ type: "redis", namespace: "cp-addons-test" });
      expect(result.items.every((a) => a.type === "redis")).to.be.true;
    });

    it("should filter addons by status", async function () {
      if (!dbAvailable) this.skip();

      const id = await repo.add(makeAddonPayload());
      createdIds.push(id);
      await repo.updateStatus(id, "running");

      const running = await repo.getAll({ status: "running", namespace: "cp-addons-test" });
      const pending = await repo.getAll({ status: "pending", namespace: "cp-addons-test" });

      expect(running.items.every((a) => a.status === "running")).to.be.true;
      expect(pending.items.every((a) => a.status === "pending")).to.be.true;
    });

    it("should search addons by name", async function () {
      if (!dbAvailable) this.skip();

      const uniqueName = `unique-${Date.now()}`;
      const id = await repo.add(makeAddonPayload({ name: uniqueName }));
      createdIds.push(id);

      const result = await repo.getAll({ search: uniqueName });
      expect(result.items).to.have.lengthOf(1);
      expect(result.items[0].name).to.equal(uniqueName);
    });

    it("should get addons by status", async function () {
      if (!dbAvailable) this.skip();

      const id = await repo.add(makeAddonPayload());
      createdIds.push(id);

      const pendingAddons = await repo.getByStatus("pending");
      expect(pendingAddons.some((a) => a._id!.toString() === id)).to.be.true;
    });

    it("should get addons by namespace", async function () {
      if (!dbAvailable) this.skip();

      const id = await repo.add(makeAddonPayload({ namespace: "cp-addons-test" }));
      createdIds.push(id);

      const addons = await repo.getByNamespace("cp-addons-test");
      expect(addons.some((a) => a._id!.toString() === id)).to.be.true;
    });
  });

  // -------------------------------------------------------------------------
  // Addon catalog
  // -------------------------------------------------------------------------

  describe("ADDON_CATALOG", function () {
    it("should have all required addon types", function () {
      const types: TAddonType[] = ["redis", "postgresql", "mysql", "rabbitmq", "elasticsearch"];
      for (const type of types) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
        expect(ADDON_CATALOG[type].version).to.be.a("string");
      }
    });

    it("should have chart defined for all types", function () {
      for (const [type, catalog] of Object.entries(ADDON_CATALOG)) {
        expect(catalog.chart).to.be.a("string").and.not.be.empty;
      }
    });
  });

  // -------------------------------------------------------------------------
  // Addon Types
  // -------------------------------------------------------------------------

  describe("Addon Types", function () {
    it("should have all database types in catalog", function () {
      const databaseTypes: TAddonType[] = ["mongodb", "postgresql", "mysql", "mariadb", "clickhouse"];
      for (const type of databaseTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].defaultPort).to.be.a("number");
      }
    });

    it("should have all caching types in catalog", function () {
      const cachingTypes: TAddonType[] = ["redis", "keydb", "dragonfly", "memcached"];
      for (const type of cachingTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all search types in catalog", function () {
      const searchTypes: TAddonType[] = ["elasticsearch", "meilisearch", "typesense"];
      for (const type of searchTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all queue types in catalog", function () {
      const queueTypes: TAddonType[] = ["rabbitmq", "nats", "kafka"];
      for (const type of queueTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all storage types in catalog", function () {
      const storageTypes: TAddonType[] = ["minio", "seaweedfs"];
      for (const type of storageTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all analytics types in catalog", function () {
      const analyticsTypes: TAddonType[] = ["plausible", "umami", "matomo", "posthog"];
      for (const type of analyticsTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all automation types in catalog", function () {
      const automationTypes: TAddonType[] = ["n8n", "activepieces", "windmill", "temporal"];
      for (const type of automationTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all development types in catalog", function () {
      const devTypes: TAddonType[] = ["gitea", "gitlab", "forgejo", "codeserver"];
      for (const type of devTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all monitoring types in catalog", function () {
      const monitoringTypes: TAddonType[] = ["grafana", "uptimekuma", "prometheus", "healthchecks"];
      for (const type of monitoringTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all CMS types in catalog", function () {
      const cmsTypes: TAddonType[] = ["ghost", "strapi", "directus", "wordpress"];
      for (const type of cmsTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have all communication types in catalog", function () {
      const commTypes: TAddonType[] = ["mattermost", "rocketchat", "listmonk"];
      for (const type of commTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        expect(ADDON_CATALOG[type].chart).to.be.a("string");
      }
    });

    it("should have at least 40 addon types", function () {
      expect(addonTypes.length).to.be.at.least(40);
      expect(Object.keys(ADDON_CATALOG).length).to.be.at.least(40);
    });

    it("should have catalog entries for every addonType", function () {
      for (const type of addonTypes) {
        expect(ADDON_CATALOG).to.have.property(type);
        const entry = ADDON_CATALOG[type];
        expect(entry.chart).to.be.a("string").and.not.be.empty;
        expect(entry.version).to.be.a("string").and.not.be.empty;
        expect(entry.defaultPort).to.be.a("number").and.be.greaterThan(0);
        expect(entry.defaultValues).to.be.an("object");
      }
    });
  });

  // -------------------------------------------------------------------------
  // Helper Functions
  // -------------------------------------------------------------------------

  describe("Helper Functions", function () {
    describe("getAddonDefaultPort()", function () {
      it("should return correct port for MongoDB", function () {
        expect(getAddonDefaultPort("mongodb")).to.equal(27017);
      });

      it("should return correct port for PostgreSQL", function () {
        expect(getAddonDefaultPort("postgresql")).to.equal(5432);
      });

      it("should return correct port for MySQL", function () {
        expect(getAddonDefaultPort("mysql")).to.equal(3306);
      });

      it("should return correct port for MariaDB", function () {
        expect(getAddonDefaultPort("mariadb")).to.equal(3306);
      });

      it("should return correct port for ClickHouse", function () {
        expect(getAddonDefaultPort("clickhouse")).to.equal(9000);
      });

      it("should return correct port for Redis", function () {
        expect(getAddonDefaultPort("redis")).to.equal(6379);
      });

      it("should return correct port for KeyDB", function () {
        expect(getAddonDefaultPort("keydb")).to.equal(6379);
      });

      it("should return correct port for Dragonfly", function () {
        expect(getAddonDefaultPort("dragonfly")).to.equal(6379);
      });

      it("should return correct port for Memcached", function () {
        expect(getAddonDefaultPort("memcached")).to.equal(11211);
      });

      it("should return correct port for Elasticsearch", function () {
        expect(getAddonDefaultPort("elasticsearch")).to.equal(9200);
      });

      it("should return correct port for Meilisearch", function () {
        expect(getAddonDefaultPort("meilisearch")).to.equal(7700);
      });

      it("should return correct port for RabbitMQ", function () {
        expect(getAddonDefaultPort("rabbitmq")).to.equal(5672);
      });

      it("should return correct port for NATS", function () {
        expect(getAddonDefaultPort("nats")).to.equal(4222);
      });

      it("should return correct port for Kafka", function () {
        expect(getAddonDefaultPort("kafka")).to.equal(9092);
      });

      it("should return correct port for MinIO", function () {
        expect(getAddonDefaultPort("minio")).to.equal(9000);
      });

      it("should return correct port for Grafana", function () {
        expect(getAddonDefaultPort("grafana")).to.equal(3000);
      });

      it("should return correct port for Prometheus", function () {
        expect(getAddonDefaultPort("prometheus")).to.equal(9090);
      });

      it("should return a port for every addon type", function () {
        for (const type of addonTypes) {
          const port = getAddonDefaultPort(type);
          expect(port).to.be.a("number");
          expect(port).to.be.greaterThan(0);
          expect(port).to.be.lessThanOrEqual(65535);
        }
      });
    });

    describe("isDatabaseType()", function () {
      it("should return true for mongodb", function () {
        expect(isDatabaseType("mongodb")).to.be.true;
      });

      it("should return true for postgresql", function () {
        expect(isDatabaseType("postgresql")).to.be.true;
      });

      it("should return true for mysql", function () {
        expect(isDatabaseType("mysql")).to.be.true;
      });

      it("should return true for mariadb", function () {
        expect(isDatabaseType("mariadb")).to.be.true;
      });

      it("should return true for clickhouse", function () {
        expect(isDatabaseType("clickhouse")).to.be.true;
      });

      it("should return false for redis", function () {
        expect(isDatabaseType("redis")).to.be.false;
      });

      it("should return false for elasticsearch", function () {
        expect(isDatabaseType("elasticsearch")).to.be.false;
      });

      it("should return false for rabbitmq", function () {
        expect(isDatabaseType("rabbitmq")).to.be.false;
      });

      it("should return false for minio", function () {
        expect(isDatabaseType("minio")).to.be.false;
      });

      it("should return false for grafana", function () {
        expect(isDatabaseType("grafana")).to.be.false;
      });
    });

    describe("isRedisType()", function () {
      it("should return true for redis", function () {
        expect(isRedisType("redis")).to.be.true;
      });

      it("should return true for keydb", function () {
        expect(isRedisType("keydb")).to.be.true;
      });

      it("should return true for dragonfly", function () {
        expect(isRedisType("dragonfly")).to.be.true;
      });

      it("should return false for mongodb", function () {
        expect(isRedisType("mongodb")).to.be.false;
      });

      it("should return false for memcached", function () {
        expect(isRedisType("memcached")).to.be.false;
      });

      it("should return false for postgresql", function () {
        expect(isRedisType("postgresql")).to.be.false;
      });

      it("should return false for elasticsearch", function () {
        expect(isRedisType("elasticsearch")).to.be.false;
      });
    });
  });

  // -------------------------------------------------------------------------
  // Config Field
  // -------------------------------------------------------------------------

  describe("Config Field", function () {
    it("should store config with addon", async function () {
      if (!dbAvailable) this.skip();

      const config = { replicas: 3, tls: true, rootPassword: "test-password" };
      const payload = makeAddonPayload({ config });
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const addon = await repo.getById(insertedId);
      expect(addon).to.exist;
      expect(addon!.config).to.deep.equal(config);
      expect(addon!.config!.replicas).to.equal(3);
      expect(addon!.config!.tls).to.be.true;
      expect(addon!.config!.rootPassword).to.equal("test-password");
    });

    it("should preserve config on update", async function () {
      if (!dbAvailable) this.skip();

      const config = { replicas: 3, tls: true, rootPassword: "test-password" };
      const payload = makeAddonPayload({ config });
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      // Update status (should not affect config)
      await repo.updateStatus(insertedId, "running");

      const addon = await repo.getById(insertedId);
      expect(addon).to.exist;
      expect(addon!.config).to.deep.equal(config);
      expect(addon!.status).to.equal("running");
    });

    it("should default to empty config object", async function () {
      if (!dbAvailable) this.skip();

      const payload = makeAddonPayload();
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const addon = await repo.getById(insertedId);
      expect(addon).to.exist;
      expect(addon!.config).to.deep.equal({});
    });

    it("should store nested config values", async function () {
      if (!dbAvailable) this.skip();

      const config = {
        replication: {
          enabled: true,
          replicas: 3,
        },
        resources: {
          requests: { memory: "256Mi", cpu: "100m" },
          limits: { memory: "512Mi", cpu: "500m" },
        },
      };
      const payload = makeAddonPayload({ config });
      const insertedId = await repo.add(payload);
      createdIds.push(insertedId);

      const addon = await repo.getById(insertedId);
      expect(addon).to.exist;
      expect(addon!.config).to.deep.equal(config);
      expect(addon!.config!.replication.replicas).to.equal(3);
      expect(addon!.config!.resources.requests.memory).to.equal("256Mi");
    });

    it("should include config in model output", function () {
      const config = { replicas: 2, tls: false };
      const addon = modelAddon(makeAddonPayload({ config }));

      expect(addon.config).to.deep.equal(config);
    });
  });

  // -------------------------------------------------------------------------
  // Helm Values Building (indirect test via model)
  // -------------------------------------------------------------------------

  describe("Helm Values Building", function () {
    it("should merge user values with catalog defaults for redis", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "redis" as TAddonType,
        values: { auth: { password: "custom-password" } },
      }));

      // Should have merged values
      expect(addon.values.auth).to.exist;
      expect(addon.values.auth.password).to.equal("custom-password");
      // Architecture from catalog defaults should be preserved
      expect(addon.values.architecture).to.equal("standalone");
    });

    it("should merge user values with catalog defaults for mongodb", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "mongodb" as TAddonType,
        values: { replicaCount: 3 },
      }));

      // User value
      expect(addon.values.replicaCount).to.equal(3);
      // Catalog defaults
      expect(addon.values.architecture).to.equal("standalone");
      expect(addon.values.auth.enabled).to.be.true;
    });

    it("should merge user values with catalog defaults for postgresql", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "postgresql" as TAddonType,
        values: { primary: { persistence: { size: "10Gi" } } },
      }));

      // User value
      expect(addon.values.primary.persistence.size).to.equal("10Gi");
      // Catalog defaults
      expect(addon.values.auth).to.exist;
    });

    it("should override catalog defaults when user provides same key", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "redis" as TAddonType,
        values: { architecture: "replication" },
      }));

      // User value should override catalog default
      expect(addon.values.architecture).to.equal("replication");
    });

    it("should include catalog defaults for elasticsearch", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "elasticsearch" as TAddonType,
        values: {},
      }));

      // Catalog defaults for elasticsearch
      expect(addon.values.master.replicaCount).to.equal(1);
      expect(addon.values.data.replicaCount).to.equal(1);
      expect(addon.values.security.enabled).to.be.false;
    });

    it("should include catalog defaults for rabbitmq", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "rabbitmq" as TAddonType,
        values: {},
      }));

      // Catalog defaults for rabbitmq
      expect(addon.values.auth.username).to.equal("admin");
    });

    it("should include catalog defaults for minio", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "minio" as TAddonType,
        values: {},
      }));

      // Catalog defaults for minio
      expect(addon.values.auth.rootUser).to.equal("admin");
      expect(addon.values.mode).to.equal("standalone");
    });

    it("should include catalog defaults for grafana", function () {
      const addon = modelAddon(makeAddonPayload({
        type: "grafana" as TAddonType,
        values: {},
      }));

      // Catalog defaults for grafana
      expect(addon.values.adminUser).to.equal("admin");
    });

    it("should use catalog version when building values", function () {
      for (const type of ["redis", "mongodb", "postgresql", "mysql"] as TAddonType[]) {
        const addon = modelAddon(makeAddonPayload({ type }));
        expect(addon.version).to.equal(ADDON_CATALOG[type].version);
      }
    });
  });
});
