import { ObjectId } from "mongodb";
import crypto from "crypto";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate, normalizePage, TPaginated } from "../../utils/paginate";
import { BadRequestError, ConflictError, NotFoundError } from "../../utils/error";
import {
  TDatabase,
  TDatabaseNode,
  TDatabaseStatus,
  TDatabaseNodeStatus,
  TDatabaseNodeRole,
  TDatabaseDNS,
  TDatabaseTLS,
  TDatabaseBackup,
  modelDatabase,
} from "./database.model";

const namespace_collection = "cp_databases";

// =============================================================================
// Encryption Helpers (same pattern as ssh-key repo)
// =============================================================================

const ENCRYPTION_KEY =
  process.env.SECRET_ENCRYPTION_KEY ||
  process.env.SECRET_KEY ||
  "default-key-change-in-production!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey(): Buffer {
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }

  const [ivHex, authTagHex, encrypted] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const key = getEncryptionKey();

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

// =============================================================================
// List item type (excludes sensitive credentials)
// =============================================================================

export type TDatabaseListItem = Omit<TDatabase, "credentials"> & {
  credentials?: {
    adminUser: string;
  };
};

// =============================================================================
// Repository
// =============================================================================

export function useDatabaseRepo() {
  const repo = useRepo(namespace_collection);

  /**
   * Create indexes for the databases collection.
   * Indexes cover: name (unique), type, status, nodes.serverId
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { type: 1 } },
        { key: { status: 1 } },
        { key: { "nodes.serverId": 1 } },
        { key: { type: 1, status: 1 } },
        { key: { name: "text" } },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create database indexes.");
    }
  }

  /**
   * Add a new database.
   * Encrypts adminPassword before storing.
   * Throws ConflictError if name already exists.
   */
  async function add(data: Partial<TDatabase>): Promise<string> {
    // Model validates and normalizes data
    const database = modelDatabase(data);

    // Encrypt adminPassword before storing
    const encryptedDatabase = {
      ...database,
      credentials: {
        ...database.credentials,
        adminPassword: encrypt(database.credentials.adminPassword),
      },
    };

    try {
      const result = await repo.collection.insertOne(encryptedDatabase as any);
      repo.delCachedData();
      return result.insertedId.toString();
    } catch (error: any) {
      // Handle duplicate key error
      if (error.code === 11000) {
        throw new ConflictError(
          `Database with name "${database.name}" already exists.`
        );
      }
      throw error;
    }
  }

  /**
   * Get database by ID.
   * Returns full credentials (decrypted) for admin operations.
   * Returns null if not found.
   */
  async function getById(id: string): Promise<TDatabase | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, { id, tag: "by-id" });
    const cached = await repo.getCache<TDatabase>(cacheKey);
    if (cached) {
      // Decrypt adminPassword from cached data
      try {
        cached.credentials.adminPassword = decrypt(
          cached.credentials.adminPassword
        );
        return cached;
      } catch {
        // If decryption fails, fetch fresh from DB
      }
    }

    const database = await repo.collection.findOne({ _id: oid });
    if (!database) return null;

    // Decrypt adminPassword
    try {
      database.credentials.adminPassword = decrypt(
        database.credentials.adminPassword
      );
    } catch {
      throw new BadRequestError("Failed to decrypt database credentials.");
    }

    // Cache with encrypted password (we'll decrypt on retrieval)
    const toCache = {
      ...database,
      credentials: {
        ...database.credentials,
        adminPassword: encrypt(database.credentials.adminPassword),
      },
    };
    repo.setCache(cacheKey, toCache, 600);

    return database as TDatabase;
  }

  /**
   * Get database by name.
   * Returns full credentials (decrypted).
   * Returns null if not found.
   */
  async function getByName(name: string): Promise<TDatabase | null> {
    const cacheKey = makeCacheKey(namespace_collection, { name, tag: "by-name" });
    const cached = await repo.getCache<TDatabase>(cacheKey);
    if (cached) {
      try {
        cached.credentials.adminPassword = decrypt(
          cached.credentials.adminPassword
        );
        return cached;
      } catch {
        // If decryption fails, fetch fresh from DB
      }
    }

    const database = await repo.collection.findOne({ name });
    if (!database) return null;

    // Decrypt adminPassword
    try {
      database.credentials.adminPassword = decrypt(
        database.credentials.adminPassword
      );
    } catch {
      throw new BadRequestError("Failed to decrypt database credentials.");
    }

    // Cache with encrypted password
    const toCache = {
      ...database,
      credentials: {
        ...database.credentials,
        adminPassword: encrypt(database.credentials.adminPassword),
      },
    };
    repo.setCache(cacheKey, toCache, 600);

    return database as TDatabase;
  }

  /**
   * Get all databases with pagination and filtering.
   * Does NOT return adminPassword or connectionString.
   */
  async function getAll(options: {
    page?: number;
    limit?: number;
    type?: string;
    status?: string;
    search?: string;
  } = {}): Promise<TPaginated<TDatabaseListItem>> {
    const { page = 1, limit = 20, type, status, search } = options;

    const cacheKey = makeCacheKey(namespace_collection, {
      page,
      limit,
      type: type || "",
      status: status || "",
      search: search || "",
      tag: "getAll",
    });
    const cached = await repo.getCache<TPaginated<TDatabaseListItem>>(cacheKey);
    if (cached) return cached;

    // Build query filter
    const query: Record<string, any> = {};
    if (type) query.type = type;
    if (status) query.status = status;
    if (search) {
      // Case-insensitive search on name
      const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escaped, $options: "i" };
    }

    const skip = normalizePage(page) * limit;

    // Project to exclude sensitive credentials
    const projection = {
      "credentials.adminPassword": 0,
      "credentials.connectionString": 0,
    };

    const [items, total] = await Promise.all([
      repo.collection
        .find(query)
        .project(projection)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      repo.collection.countDocuments(query),
    ]);

    const result = paginate(items as TDatabaseListItem[], page, limit, total);
    repo.setCache(cacheKey, result, 300);
    return result;
  }

  /**
   * Update database by ID.
   * Does NOT allow updating credentials through this method.
   */
  async function updateById(
    id: string,
    data: Partial<Omit<TDatabase, "_id" | "credentials" | "nodes" | "createdAt">>
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const updateData = {
      ...data,
      updatedAt: new Date(),
    };

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Update database status.
   */
  async function updateStatus(id: string, status: TDatabaseStatus): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { status, updatedAt: new Date() } }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Delete database by ID.
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  // ===========================================================================
  // Node Management
  // ===========================================================================

  /**
   * Add a node to a database.
   */
  async function addNode(
    id: string,
    node: { serverId: ObjectId; role: TDatabaseNodeRole; status: TDatabaseNodeStatus }
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $push: { nodes: node } as any,
        $set: { updatedAt: new Date() },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Remove a node from a database by serverId.
   */
  async function removeNode(id: string, serverId: string): Promise<void> {
    let oid: ObjectId;
    let serverOid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }
    try {
      serverOid = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $pull: { nodes: { serverId: serverOid } } as any,
        $set: { updatedAt: new Date() },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Update the status of a specific node.
   */
  async function updateNodeStatus(
    id: string,
    serverId: string,
    status: TDatabaseNodeStatus
  ): Promise<void> {
    let oid: ObjectId;
    let serverOid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }
    try {
      serverOid = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid, "nodes.serverId": serverOid },
      {
        $set: {
          "nodes.$.status": status,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database or node not found.");
    }
    repo.delCachedData();
  }

  // ===========================================================================
  // Server Queries
  // ===========================================================================

  /**
   * Find all databases that have a node on the specified server.
   */
  async function getByServerId(serverId: string): Promise<TDatabase[]> {
    let serverOid: ObjectId;
    try {
      serverOid = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      serverId,
      tag: "by-server",
    });
    const cached = await repo.getCache<TDatabase[]>(cacheKey);
    if (cached) return cached;

    const databases = await repo.collection
      .find({ "nodes.serverId": serverOid })
      .toArray();

    repo.setCache(cacheKey, databases, 300);
    return databases as TDatabase[];
  }

  /**
   * Count databases that have a node on the specified server.
   */
  async function countByServerId(serverId: string): Promise<number> {
    let serverOid: ObjectId;
    try {
      serverOid = new ObjectId(serverId);
    } catch {
      throw new BadRequestError("Invalid server ID format.");
    }

    const cacheKey = makeCacheKey(namespace_collection, {
      serverId,
      tag: "count-by-server",
    });
    const cached = await repo.getCache<number>(cacheKey);
    if (cached !== null && cached !== undefined) return cached;

    const count = await repo.collection.countDocuments({
      "nodes.serverId": serverOid,
    });

    repo.setCache(cacheKey, count, 300);
    return count;
  }

  // ===========================================================================
  // Backup
  // ===========================================================================

  /**
   * Update the lastBackup timestamp for a database.
   */
  async function updateBackupTime(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          "backup.lastBackup": new Date(),
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Update backup configuration for a database.
   */
  async function updateBackupConfig(id: string, backup: TDatabaseBackup): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          backup,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  // ===========================================================================
  // DNS Management
  // ===========================================================================

  /**
   * Update DNS configuration for a database.
   */
  async function updateDNS(id: string, dns: TDatabaseDNS): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          dns,
          "credentials.srvConnectionString": dns.srvConnectionString,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Remove DNS configuration from a database.
   */
  async function removeDNS(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $unset: { dns: "", "credentials.srvConnectionString": "" },
        $set: { updatedAt: new Date() },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  // ===========================================================================
  // Deployment Logs
  // ===========================================================================

  /**
   * Append a log entry to the deployment logs.
   */
  async function appendLog(id: string, log: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $push: { deploymentLogs: log } as any,
        $set: { updatedAt: new Date() },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Clear all deployment logs for a database.
   */
  async function clearLogs(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { deploymentLogs: [], updatedAt: new Date() } }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  // ===========================================================================
  // TLS Management
  // ===========================================================================

  /**
   * Update TLS configuration for a database.
   */
  async function updateTLS(id: string, tls: TDatabaseTLS): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $set: {
          tls,
          updatedAt: new Date(),
        },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  /**
   * Remove TLS configuration from a database.
   */
  async function removeTLS(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid database ID format.");
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      {
        $unset: { tls: "" },
        $set: { updatedAt: new Date() },
      }
    );

    if (!result.matchedCount) {
      throw new NotFoundError("Database not found.");
    }
    repo.delCachedData();
  }

  return {
    createIndexes,
    add,
    getById,
    getByName,
    getAll,
    updateById,
    updateStatus,
    deleteById,
    addNode,
    removeNode,
    updateNodeStatus,
    getByServerId,
    countByServerId,
    updateBackupTime,
    updateBackupConfig,
    updateDNS,
    removeDNS,
    updateTLS,
    removeTLS,
    appendLog,
    clearLogs,
  };
}
