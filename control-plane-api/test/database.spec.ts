import { expect } from "chai";
import { describe, it, afterEach } from "mocha";
import { ObjectId } from "mongodb";
import { useDatabaseRepo } from "../src/resources/database/database.repository";
import { modelDatabase, TDatabaseType, TDatabaseNodeRole, TDatabaseNodeStatus } from "../src/resources/database/database.model";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal valid database payload. */
function makeDbPayload(overrides: Record<string, unknown> = {}) {
  return {
    name: `test-db-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: "mongodb" as TDatabaseType,
    version: "7.0",
    credentials: {
      adminUser: "admin",
      adminPassword: "supersecretpassword",
      connectionString: "",
    },
    nodes: [
      {
        serverId: new ObjectId().toString(),
        role: "primary" as TDatabaseNodeRole,
        status: "stopped" as TDatabaseNodeStatus,
      },
    ],
    config: { port: 27017, replicaSetName: "rs0" },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Database Resource", function () {
  this.timeout(15000);

  const repo = useDatabaseRepo();
  const createdIds: string[] = [];

  afterEach(async () => {
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

  describe("modelDatabase()", () => {
    it("should build a valid database document from a minimal payload", () => {
      const db = modelDatabase(makeDbPayload());

      expect(db.name).to.be.a("string");
      expect(db.type).to.equal("mongodb");
      expect(db.version).to.equal("7.0");
      expect(db.status).to.equal("provisioning"); // always set on create
      expect(db.nodes).to.have.length(1);
      expect(db.nodes[0].role).to.equal("primary");
      expect(db.createdAt).to.be.instanceOf(Date);
    });

    it("should convert string serverId to ObjectId in nodes", () => {
      const serverId = new ObjectId().toString();
      const db = modelDatabase(makeDbPayload({ nodes: [{ serverId, role: "secondary" as TDatabaseNodeRole, status: "stopped" as TDatabaseNodeStatus }] }));
      expect(db.nodes[0].serverId).to.be.instanceOf(ObjectId);
    });

    it("should throw BadRequestError for missing required fields", () => {
      expect(() => modelDatabase({ name: "incomplete" } as any)).to.throw(
        /Database validation error/
      );
    });
  });

  // -------------------------------------------------------------------------
  // Repository CRUD
  // -------------------------------------------------------------------------

  describe("useDatabaseRepo() — CRUD", () => {
    it("should add and retrieve a database by ID", async () => {
      const payload = makeDbPayload();
      const insertedId = await repo.add(payload as any);
      createdIds.push(insertedId.toString());

      const db = await repo.getById(insertedId.toString());
      expect(db).to.exist;
      expect(db!.name).to.equal(payload.name);
      expect(db!.type).to.equal("mongodb");
      expect(db!.status).to.equal("provisioning");
    });

    it("should throw BadRequestError for duplicate database name", async () => {
      const payload = makeDbPayload();
      const id = await repo.add(payload as any);
      createdIds.push(id.toString());

      try {
        await repo.add(payload as any);
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.message).to.include("already exists");
      }
    });

    it("should return null for a non-existent ID", async () => {
      const result = await repo.getById(new ObjectId().toString());
      expect(result).to.be.null;
    });

    it("should update a database by ID", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      await repo.updateById(id.toString(), { version: "8.0" });

      const updated = await repo.getById(id.toString());
      expect(updated!.version).to.equal("8.0");
    });

    it("should updateStatus correctly", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      await repo.updateStatus(id.toString(), "running");

      const db = await repo.getById(id.toString());
      expect(db!.status).to.equal("running");
    });

    it("should delete a database by ID", async () => {
      const id = await repo.add(makeDbPayload() as any);
      // Don't push to createdIds — we delete it in the test

      await repo.deleteById(id.toString());

      const db = await repo.getById(id.toString());
      expect(db).to.be.null;
    });
  });

  // -------------------------------------------------------------------------
  // Listing + filtering
  // -------------------------------------------------------------------------

  describe("useDatabaseRepo() — getAll()", () => {
    it("should return paginated results", async () => {
      const ids = await Promise.all([
        repo.add(makeDbPayload() as any),
        repo.add(makeDbPayload() as any),
      ]);
      ids.forEach((id) => createdIds.push(id.toString()));

      const result = await repo.getAll({ page: 1, limit: 50 });
      expect(result.items).to.be.an("array");
      expect(result.items.length).to.be.at.least(2);
      expect(result.pages).to.be.at.least(1);
    });

    it("should filter by type", async () => {
      const mongoId = await repo.add(makeDbPayload({ type: "mongodb" }) as any);
      createdIds.push(mongoId.toString());

      const result = await repo.getAll({ type: "mongodb", page: 1, limit: 50 });
      expect(result.items.every((db: any) => db.type === "mongodb")).to.be.true;
    });

    it("should filter by status", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());
      await repo.updateStatus(id.toString(), "running");

      const result = await repo.getAll({ status: "running", page: 1, limit: 50 });
      expect(result.items.some((db: any) => db._id.toString() === id.toString())).to.be.true;
    });

    it("should search by name (case-insensitive)", async () => {
      const unique = `myspecialdb-${Date.now()}`;
      const id = await repo.add(makeDbPayload({ name: unique }) as any);
      createdIds.push(id.toString());

      const result = await repo.getAll({ search: unique.toUpperCase(), page: 1, limit: 10 });
      expect(result.items.some((db: any) => db.name === unique)).to.be.true;
    });

    it("should exclude credentials from list view", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      const result = await repo.getAll({ page: 1, limit: 50 });
      const found = result.items.find((db: any) => db._id.toString() === id.toString());
      expect(found).to.exist;
      expect((found as any).credentials?.adminPassword).to.be.undefined;
      expect((found as any).credentials?.connectionString).to.be.undefined;
    });
  });

  // -------------------------------------------------------------------------
  // Node management
  // -------------------------------------------------------------------------

  describe("useDatabaseRepo() — node management", () => {
    it("should add a node to a database", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      const newServerId = new ObjectId();
      await repo.addNode(id.toString(), {
        serverId: newServerId,
        role: "secondary",
        status: "stopped",
      });

      const db = await repo.getById(id.toString());
      expect(db!.nodes).to.have.length(2);
      expect(db!.nodes.some((n: any) => n.serverId.toString() === newServerId.toString())).to.be.true;
    });

    it("should remove a node from a database", async () => {
      const secondaryId = new ObjectId();
      const id = await repo.add(
        makeDbPayload({
          nodes: [
            { serverId: new ObjectId().toString(), role: "primary", status: "stopped" },
            { serverId: secondaryId.toString(), role: "secondary", status: "stopped" },
          ],
        }) as any
      );
      createdIds.push(id.toString());

      await repo.removeNode(id.toString(), secondaryId.toString());

      const db = await repo.getById(id.toString());
      expect(db!.nodes).to.have.length(1);
      expect(db!.nodes[0].role).to.equal("primary");
    });

    it("should update the status of a specific node", async () => {
      const serverId = new ObjectId();
      const id = await repo.add(
        makeDbPayload({
          nodes: [{ serverId: serverId.toString(), role: "primary", status: "stopped" }],
        }) as any
      );
      createdIds.push(id.toString());

      await repo.updateNodeStatus(id.toString(), serverId.toString(), "running");

      const db = await repo.getById(id.toString());
      expect(db!.nodes[0].status).to.equal("running");
    });

    it("should find all databases for a given server", async () => {
      const sharedServerId = new ObjectId();
      const id1 = await repo.add(
        makeDbPayload({ nodes: [{ serverId: sharedServerId.toString(), role: "primary", status: "stopped" }] }) as any
      );
      const id2 = await repo.add(
        makeDbPayload({ nodes: [{ serverId: new ObjectId().toString(), role: "primary", status: "stopped" }] }) as any
      );
      createdIds.push(id1.toString(), id2.toString());

      const results = await repo.getByServerId(sharedServerId.toString());
      expect(results).to.be.an("array");
      expect(results.some((db: any) => db._id.toString() === id1.toString())).to.be.true;
      expect(results.some((db: any) => db._id.toString() === id2.toString())).to.be.false;
    });

    it("should count databases for a given server", async () => {
      const countServerId = new ObjectId();
      const id = await repo.add(
        makeDbPayload({ nodes: [{ serverId: countServerId.toString(), role: "primary", status: "stopped" }] }) as any
      );
      createdIds.push(id.toString());

      const count = await repo.countByServerId(countServerId.toString());
      expect(count).to.be.at.least(1);
    });
  });

  // -------------------------------------------------------------------------
  // Backup time
  // -------------------------------------------------------------------------

  describe("useDatabaseRepo() — backup", () => {
    it("should update lastBackup time", async () => {
      const id = await repo.add(
        makeDbPayload({
          backup: { enabled: true, schedule: "0 0 * * *", s3Bucket: "my-bucket" },
        }) as any
      );
      createdIds.push(id.toString());

      await repo.updateBackupTime(id.toString());

      const db = await repo.getById(id.toString());
      expect(db!.backup?.lastBackup).to.be.instanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // TLS management
  // -------------------------------------------------------------------------

  describe("useDatabaseRepo() — TLS", () => {
    it("should update TLS configuration for a database", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      const tlsConfig = {
        enabled: true,
        caCert: "-----BEGIN CERTIFICATE-----\nMIIC...\n-----END CERTIFICATE-----",
        tlsConnectionString: "mongodb://host:27017/?tls=true",
        configuredAt: new Date(),
      };

      await repo.updateTLS(id.toString(), tlsConfig);

      const db = await repo.getById(id.toString());
      expect(db!.tls).to.exist;
      expect(db!.tls!.enabled).to.be.true;
      expect(db!.tls!.caCert).to.equal(tlsConfig.caCert);
      expect(db!.tls!.tlsConnectionString).to.equal(tlsConfig.tlsConnectionString);
      expect(db!.tls!.configuredAt).to.be.instanceOf(Date);
    });

    it("should remove TLS configuration from a database", async () => {
      const id = await repo.add(makeDbPayload() as any);
      createdIds.push(id.toString());

      // First add TLS config
      await repo.updateTLS(id.toString(), {
        enabled: true,
        caCert: "test-cert",
        tlsConnectionString: "mongodb://host:27017/?tls=true",
        configuredAt: new Date(),
      });

      // Verify it was added
      let db = await repo.getById(id.toString());
      expect(db!.tls).to.exist;
      expect(db!.tls!.enabled).to.be.true;

      // Now remove TLS config
      await repo.removeTLS(id.toString());

      // Verify it was removed
      db = await repo.getById(id.toString());
      expect(db!.tls).to.be.undefined;
    });

    it("should throw NotFoundError when updating TLS for non-existent database", async () => {
      const fakeId = new ObjectId().toString();
      try {
        await repo.updateTLS(fakeId, {
          enabled: true,
          caCert: "test-cert",
          tlsConnectionString: "mongodb://host:27017/?tls=true",
          configuredAt: new Date(),
        });
        expect.fail("Should have thrown NotFoundError");
      } catch (err: any) {
        expect(err.message).to.equal("Database not found.");
      }
    });

    it("should throw BadRequestError for invalid database ID format", async () => {
      try {
        await repo.updateTLS("invalid-id", {
          enabled: true,
          caCert: "test-cert",
          tlsConnectionString: "mongodb://host:27017/?tls=true",
          configuredAt: new Date(),
        });
        expect.fail("Should have thrown BadRequestError");
      } catch (err: any) {
        expect(err.message).to.equal("Invalid database ID format.");
      }
    });
  });
});
