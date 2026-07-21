import { expect } from "chai";
import { describe, it, afterEach, before } from "mocha";
import {
  useAddonRepo,
  modelAddon,
  TAddonType,
  TAddonStatus,
  ADDON_CATALOG,
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

    it("should have bitnami charts for all types", function () {
      for (const [type, catalog] of Object.entries(ADDON_CATALOG)) {
        expect(catalog.chart).to.match(/^bitnami\//);
      }
    });
  });
});
