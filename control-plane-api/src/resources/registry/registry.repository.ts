import { ObjectId, Collection } from "mongodb";
import crypto from "crypto";
import { useAtlas } from "../../utils/atlas";
import { useCache } from "../../utils/cache";
import { makeCacheKey } from "../../utils/make-cache-key";
import { paginate } from "../../utils/paginate";
import {
  TRegistry,
  TRegistryStatus,
  modelRegistry,
} from "./registry.model";
import {
  logger,
  NotFoundError,
  BadRequestError,
  InternalServerError,
} from "../../utils";

const COLLECTION = "cp_registries";
const CACHE_NS = "registries";

// =============================================================================
// Encryption Helpers
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
  if (!text) return text;
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

function decrypt(encryptedText: string): string {
  if (!encryptedText || !encryptedText.includes(":")) return encryptedText;

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

function encryptCredentials(
  credentials: TRegistry["credentials"]
): TRegistry["credentials"] {
  return {
    username: credentials.username,
    password: credentials.password ? encrypt(credentials.password) : undefined,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey
      ? encrypt(credentials.secretAccessKey)
      : undefined,
    serviceAccountKey: credentials.serviceAccountKey
      ? encrypt(credentials.serviceAccountKey)
      : undefined,
  };
}

function decryptCredentials(
  credentials: TRegistry["credentials"]
): TRegistry["credentials"] {
  return {
    username: credentials.username,
    password: credentials.password ? decrypt(credentials.password) : undefined,
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey
      ? decrypt(credentials.secretAccessKey)
      : undefined,
    serviceAccountKey: credentials.serviceAccountKey
      ? decrypt(credentials.serviceAccountKey)
      : undefined,
  };
}

// =============================================================================
// Helper to get the database
// =============================================================================

function getDb() {
  const db = useAtlas.getDb();
  if (!db) {
    throw new InternalServerError("Database not initialized");
  }
  return db;
}

// =============================================================================
// Repository
// =============================================================================

export function useRegistryRepo() {
  const cache = useCache(CACHE_NS);

  function getCollection(): Collection<TRegistry> {
    return getDb().collection<TRegistry>(COLLECTION);
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  async function getCache<T>(key: string): Promise<T | null> {
    return cache.getCache<T>(key);
  }

  async function setCache<T>(key: string, value: T, ttl?: number): Promise<void> {
    await cache.setCache(key, value, ttl);
  }

  async function delCachedData(): Promise<void> {
    await cache.delNamespace().catch((err) => {
      logger.log({
        level: "error",
        message: `Failed to clear cache namespace for ${CACHE_NS}: ${err.message}`,
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Create Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes(): Promise<void> {
    try {
      const collection = getCollection();
      await collection.createIndexes([
        // Unique name per organization (or global if no org)
        { key: { name: 1, organizationId: 1 }, unique: true },
        // Query by status
        { key: { status: 1 } },
        // Query by organization
        { key: { organizationId: 1 } },
        // Query by type
        { key: { type: 1 } },
        // Compound: org + status for filtered lists
        { key: { organizationId: 1, status: 1 } },
      ]);
      logger.log({
        level: "info",
        message: `Indexes created for ${COLLECTION}`,
      });
    } catch (error) {
      throw new BadRequestError("Failed to create registry indexes.");
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  async function add(data: Partial<TRegistry>): Promise<string> {
    const registry = modelRegistry(data);

    // Encrypt credentials before storing
    registry.credentials = encryptCredentials(registry.credentials);

    const result = await getCollection().insertOne(registry as any);

    logger.log({
      level: "info",
      message: `Registry created: ${registry.name} (${registry.type})`,
    });

    delCachedData();
    return result.insertedId.toString();
  }

  async function getById(id: string, decrypt = true): Promise<TRegistry | null> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    const cacheKey = makeCacheKey(CACHE_NS, { id, tag: "by-id" });
    const cached = await getCache<TRegistry>(cacheKey);
    if (cached) {
      return decrypt
        ? { ...cached, credentials: decryptCredentials(cached.credentials) }
        : cached;
    }

    const registry = await getCollection().findOne({ _id: oid });
    if (!registry) return null;

    setCache(cacheKey, registry, 600);

    return decrypt
      ? { ...registry, credentials: decryptCredentials(registry.credentials) }
      : registry;
  }

  async function getByName(
    name: string,
    organizationId?: string
  ): Promise<TRegistry | null> {
    const filter: Record<string, any> = { name };

    if (organizationId) {
      try {
        filter.organizationId = new ObjectId(organizationId);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    } else {
      filter.organizationId = { $exists: false };
    }

    const registry = await getCollection().findOne(filter);
    if (!registry) return null;

    return {
      ...registry,
      credentials: decryptCredentials(registry.credentials),
    };
  }

  async function getAll(options: {
    page?: number;
    limit?: number;
    search?: string;
    status?: TRegistryStatus;
    type?: string;
    organizationId?: string;
  } = {}): Promise<{
    items: TRegistry[];
    total: number;
    page: number;
    pages: number;
    pageRange: number[];
  }> {
    const {
      page = 1,
      limit = 20,
      search = "",
      status,
      type,
      organizationId,
    } = options;

    const cacheKey = makeCacheKey(CACHE_NS, {
      page,
      limit,
      search,
      status: status || "",
      type: type || "",
      organizationId: organizationId || "",
      tag: "getAll",
    });

    const cached = await getCache<{
      items: TRegistry[];
      total: number;
      page: number;
      pages: number;
      pageRange: number[];
    }>(cacheKey);
    if (cached) {
      // Decrypt credentials for each item
      return {
        ...cached,
        items: cached.items.map((r) => ({
          ...r,
          credentials: decryptCredentials(r.credentials),
        })),
      };
    }

    const query: Record<string, any> = {};

    if (organizationId) {
      try {
        query.organizationId = new ObjectId(organizationId);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    }

    if (status) {
      query.status = status;
    }

    if (type) {
      query.type = type;
    }

    if (search) {
      const escapedSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      query.name = { $regex: escapedSearch, $options: "i" };
    }

    const skip = (page > 0 ? page - 1 : 0) * limit;

    const [items, total] = await Promise.all([
      getCollection()
        .find(query)
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .toArray(),
      getCollection().countDocuments(query),
    ]);

    const result = paginate(items, page, limit, total);
    const fullResult = {
      ...result,
      total,
      page,
    };
    setCache(cacheKey, fullResult, 600);

    return {
      ...fullResult,
      items: result.items.map((r) => ({
        ...r,
        credentials: decryptCredentials(r.credentials),
      })),
    };
  }

  async function updateById(
    id: string,
    data: Partial<TRegistry>
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    const updateData: Partial<TRegistry> = {
      ...data,
      updatedAt: new Date(),
    };

    // Encrypt credentials if provided
    if (updateData.credentials) {
      updateData.credentials = encryptCredentials(updateData.credentials);
    }

    // Handle organizationId conversion
    if (data.organizationId) {
      try {
        updateData.organizationId = new ObjectId(data.organizationId as any);
      } catch {
        throw new BadRequestError("Invalid organizationId format.");
      }
    }

    // Remove _id from update
    delete (updateData as any)._id;

    const result = await getCollection().updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundError("Registry not found.");
    }

    logger.log({
      level: "info",
      message: `Registry updated: ${id}`,
    });

    delCachedData();
  }

  async function updateStatus(
    id: string,
    status: TRegistryStatus,
    verificationError?: string
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    const updateData: Partial<TRegistry> = {
      status,
      updatedAt: new Date(),
    };

    if (status === "active") {
      updateData.lastVerifiedAt = new Date();
      updateData.verificationError = undefined;
    } else if (status === "error") {
      updateData.verificationError = verificationError;
    }

    const result = await getCollection().updateOne(
      { _id: oid },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundError("Registry not found.");
    }

    delCachedData();
  }

  async function updateNamespaces(
    id: string,
    namespaces: string[]
  ): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    const result = await getCollection().updateOne(
      { _id: oid },
      {
        $set: {
          namespaces,
          updatedAt: new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      throw new NotFoundError("Registry not found.");
    }

    delCachedData();
  }

  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    const result = await getCollection().deleteOne({ _id: oid });

    if (result.deletedCount === 0) {
      throw new NotFoundError("Registry not found.");
    }

    logger.log({
      level: "info",
      message: `Registry deleted: ${id}`,
    });

    delCachedData();
  }

  async function getAllActive(): Promise<TRegistry[]> {
    const cacheKey = makeCacheKey(CACHE_NS, { tag: "active" });
    const cached = await getCache<TRegistry[]>(cacheKey);
    if (cached) {
      return cached.map((r) => ({
        ...r,
        credentials: decryptCredentials(r.credentials),
      }));
    }

    const registries = await getCollection()
      .find({ status: "active" })
      .toArray();

    setCache(cacheKey, registries, 600);

    return registries.map((r) => ({
      ...r,
      credentials: decryptCredentials(r.credentials),
    }));
  }

  async function setDefault(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid registry ID format.");
    }

    // Verify the registry exists
    const registry = await getCollection().findOne({ _id: oid });
    if (!registry) {
      throw new NotFoundError("Registry not found.");
    }

    // Unset isDefault on all registries, then set it on the target
    await getCollection().updateMany({}, { $set: { isDefault: false, updatedAt: new Date() } });
    await getCollection().updateOne({ _id: oid }, { $set: { isDefault: true, updatedAt: new Date() } });

    logger.log({
      level: "info",
      message: `Registry set as default: ${id}`,
    });

    delCachedData();
  }

  return {
    createIndexes,
    add,
    getById,
    getByName,
    getAll,
    updateById,
    updateStatus,
    updateNamespaces,
    deleteById,
    getAllActive,
    setDefault,
  };
}
