import { ObjectId, Collection } from "mongodb";
import crypto from "crypto";
import { useAtlas } from "../../utils/atlas";
import { useCache } from "../../utils/cache";
import { TSecret, modelSecret } from "./secret.model";
import { logger, NotFoundError, InternalServerError } from "../../utils";

const COLLECTION = "cp_secrets";
const CACHE_NS = "secrets";

// Helper to get the database
function getDb() {
  const db = useAtlas.getDb();
  if (!db) {
    throw new InternalServerError("Database not initialized");
  }
  return db;
}

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || process.env.SECRET_KEY || "default-key-change-in-production!";
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

// =============================================================================
// Encryption Helpers
// =============================================================================

function getEncryptionKey(): Buffer {
  // Derive a 32-byte key from the provided key using SHA-256
  return crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
}

function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = getEncryptionKey();
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Format: iv:authTag:encrypted
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
// Repository
// =============================================================================

export function useSecretRepo() {
  const cache = useCache(CACHE_NS);

  function getCollection(): Collection<TSecret> {
    return getDb().collection<TSecret>(COLLECTION);
  }

  // ---------------------------------------------------------------------------
  // Cache helpers
  // ---------------------------------------------------------------------------

  function makeCacheKey(identifier: string): string {
    return `${CACHE_NS}:${identifier}`;
  }

  async function delCachedData(patterns: string[]): Promise<void> {
    await Promise.all(patterns.map((p) => cache.delCache(makeCacheKey(p))));
  }

  // ---------------------------------------------------------------------------
  // CRUD Operations
  // ---------------------------------------------------------------------------

  async function add(data: Partial<TSecret>): Promise<ObjectId> {
    const secret = modelSecret(data);
    
    // Encrypt the value before storing
    secret.value = encrypt(secret.value);
    
    const result = await getCollection().insertOne(secret);
    
    logger.log({
      level: "info",
      message: `Secret created: ${secret.name}${secret.appId ? ` (app: ${secret.appId})` : " (global)"}`,
    });
    
    // Invalidate cache
    await delCachedData(["all", `app:${secret.appId || "global"}`]);
    
    return result.insertedId;
  }

  async function getById(id: string | ObjectId): Promise<TSecret | null> {
    const _id = typeof id === "string" ? new ObjectId(id) : id;
    const secret = await getCollection().findOne({ _id });
    
    if (secret) {
      // Decrypt the value
      try {
        secret.value = decrypt(secret.value);
      } catch (err) {
        logger.log({
          level: "error",
          message: `Failed to decrypt secret ${id}: ${err}`,
        });
        throw new Error("Failed to decrypt secret");
      }
    }
    
    return secret;
  }

  async function getByName(name: string, appId?: string | ObjectId | null): Promise<TSecret | null> {
    const filter: any = { name };
    
    if (appId) {
      filter.appId = typeof appId === "string" ? new ObjectId(appId) : appId;
    } else {
      filter.appId = { $exists: false };
    }
    
    const secret = await getCollection().findOne(filter);
    
    if (secret) {
      try {
        secret.value = decrypt(secret.value);
      } catch (err) {
        logger.log({
          level: "error",
          message: `Failed to decrypt secret ${name}: ${err}`,
        });
        throw new Error("Failed to decrypt secret");
      }
    }
    
    return secret;
  }

  async function getAll(options: {
    appId?: string | ObjectId | null;
    includeGlobal?: boolean;
  } = {}): Promise<TSecret[]> {
    const { appId, includeGlobal = true } = options;
    
    let filter: any = {};
    
    if (appId) {
      const appObjectId = typeof appId === "string" ? new ObjectId(appId) : appId;
      if (includeGlobal) {
        // Get app-specific AND global secrets
        filter = {
          $or: [
            { appId: appObjectId },
            { appId: { $exists: false } },
          ],
        };
      } else {
        // Only app-specific
        filter = { appId: appObjectId };
      }
    } else {
      // Only global secrets
      filter = { appId: { $exists: false } };
    }
    
    const secrets = await getCollection().find(filter).sort({ name: 1 }).toArray();
    
    // Decrypt all values
    for (const secret of secrets) {
      try {
        secret.value = decrypt(secret.value);
      } catch (err) {
        logger.log({
          level: "error",
          message: `Failed to decrypt secret ${secret.name}: ${err}`,
        });
        // Set to empty string instead of failing
        secret.value = "";
      }
    }
    
    return secrets;
  }

  async function getForApp(appId: string | ObjectId, secretNames: string[]): Promise<Map<string, string>> {
    const secrets = await getAll({ appId, includeGlobal: true });
    const result = new Map<string, string>();
    
    // Build map, app-specific secrets override global ones
    const globalSecrets = secrets.filter(s => !s.appId);
    const appSecrets = secrets.filter(s => s.appId);
    
    // First add global secrets
    for (const secret of globalSecrets) {
      if (secretNames.includes(secret.name)) {
        result.set(secret.name, secret.value);
      }
    }
    
    // Then override with app-specific
    for (const secret of appSecrets) {
      if (secretNames.includes(secret.name)) {
        result.set(secret.name, secret.value);
      }
    }
    
    return result;
  }

  async function updateById(
    id: string | ObjectId,
    data: Partial<Pick<TSecret, "value" | "description">>
  ): Promise<void> {
    const _id = typeof id === "string" ? new ObjectId(id) : id;
    
    const updateData: any = {
      updatedAt: new Date(),
    };
    
    if (data.value !== undefined) {
      updateData.value = encrypt(data.value);
    }
    
    if (data.description !== undefined) {
      updateData.description = data.description;
    }
    
    const result = await getCollection().updateOne(
      { _id },
      { $set: updateData }
    );
    
    if (result.matchedCount === 0) {
      throw new NotFoundError("Secret not found");
    }
    
    // Invalidate cache
    const secret = await getCollection().findOne({ _id });
    if (secret) {
      await delCachedData(["all", `app:${secret.appId || "global"}`]);
    }
    
    logger.log({
      level: "info",
      message: `Secret updated: ${id}`,
    });
  }

  async function deleteById(id: string | ObjectId): Promise<void> {
    const _id = typeof id === "string" ? new ObjectId(id) : id;
    
    const secret = await getCollection().findOne({ _id });
    
    const result = await getCollection().deleteOne({ _id });
    
    if (result.deletedCount === 0) {
      throw new NotFoundError("Secret not found");
    }
    
    // Invalidate cache
    if (secret) {
      await delCachedData(["all", `app:${secret.appId || "global"}`]);
    }
    
    logger.log({
      level: "info",
      message: `Secret deleted: ${id}`,
    });
  }

  async function deleteByAppId(appId: string | ObjectId): Promise<number> {
    const _appId = typeof appId === "string" ? new ObjectId(appId) : appId;
    
    const result = await getCollection().deleteMany({ appId: _appId });
    
    // Invalidate cache
    await delCachedData(["all", `app:${appId}`]);
    
    logger.log({
      level: "info",
      message: `Deleted ${result.deletedCount} secrets for app ${appId}`,
    });
    
    return result.deletedCount;
  }

  // ---------------------------------------------------------------------------
  // Indexes
  // ---------------------------------------------------------------------------

  async function createIndexes(): Promise<void> {
    const collection = getCollection();
    
    await collection.createIndex({ name: 1, appId: 1 }, { unique: true });
    await collection.createIndex({ appId: 1 });
    
    logger.log({
      level: "info",
      message: `Indexes created for ${COLLECTION}`,
    });
  }

  return {
    add,
    getById,
    getByName,
    getAll,
    getForApp,
    updateById,
    deleteById,
    deleteByAppId,
    createIndexes,
  };
}
