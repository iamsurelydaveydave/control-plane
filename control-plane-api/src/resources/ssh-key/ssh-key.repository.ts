import { ObjectId } from "mongodb";
import crypto from "crypto";
import { useRepo } from "../../utils/repo";
import { makeCacheKey } from "../../utils/make-cache-key";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { TSSHKey, TSSHKeyType } from "./ssh-key.model";

const namespace_collection = "cp_ssh_keys";

// Encryption key from environment (32 bytes for AES-256)
const ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || process.env.SECRET_KEY || "default-key-change-in-production!";
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

export function useSSHKeyRepo() {
  const repo = useRepo(namespace_collection);

  /**
   * Create indexes
   */
  async function createIndexes() {
    try {
      await repo.collection.createIndexes([
        { key: { name: 1 }, unique: true },
        { key: { isDefault: 1 } },
        { key: { fingerprint: 1 }, unique: true },
      ]);
    } catch (error) {
      throw new BadRequestError("Failed to create SSH key indexes.");
    }
  }

  /**
   * Get all SSH keys (without private keys)
   */
  async function getAll(): Promise<TSSHKey[]> {
    const cacheKey = makeCacheKey(namespace_collection, { tag: "getAll" });
    const cached = await repo.getCache<TSSHKey[]>(cacheKey);
    if (cached) return cached;

    const keys = await repo.collection.find({}).sort({ isDefault: -1, name: 1 }).toArray();
    
    // Don't decrypt private keys for list - they're not returned anyway
    const result = keys as TSSHKey[];
    repo.setCache(cacheKey, result, 300);
    return result;
  }

  /**
   * Get SSH key by ID (with decrypted private key)
   */
  async function getById(id: string): Promise<TSSHKey> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID format.");
    }

    const key = await repo.collection.findOne({ _id: oid });
    if (!key) throw new NotFoundError("SSH key not found.");

    // Decrypt private key
    try {
      key.privateKey = decrypt(key.privateKey);
    } catch {
      throw new BadRequestError("Failed to decrypt SSH key.");
    }

    return key as TSSHKey;
  }

  /**
   * Get SSH key by name
   */
  async function getByName(name: string): Promise<TSSHKey | null> {
    const key = await repo.collection.findOne({ name });
    if (!key) return null;

    try {
      key.privateKey = decrypt(key.privateKey);
    } catch {
      throw new BadRequestError("Failed to decrypt SSH key.");
    }

    return key as TSSHKey;
  }

  /**
   * Get the default SSH key
   */
  async function getDefault(): Promise<TSSHKey | null> {
    const key = await repo.collection.findOne({ isDefault: true });
    if (!key) return null;

    try {
      key.privateKey = decrypt(key.privateKey);
    } catch {
      throw new BadRequestError("Failed to decrypt SSH key.");
    }

    return key as TSSHKey;
  }

  /**
   * Add a new SSH key
   */
  async function add(data: Omit<TSSHKey, "_id">): Promise<string> {
    // Encrypt private key before storing
    const encryptedKey = {
      ...data,
      privateKey: encrypt(data.privateKey),
    };

    // If this is the default key, unset other defaults
    if (data.isDefault) {
      await repo.collection.updateMany(
        { isDefault: true },
        { $set: { isDefault: false, updatedAt: new Date() } }
      );
    }

    const result = await repo.collection.insertOne(encryptedKey as any);
    repo.delCachedData();
    return result.insertedId.toString();
  }

  /**
   * Update SSH key by ID
   */
  async function updateById(id: string, data: Partial<Pick<TSSHKey, "name" | "isDefault">>): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID format.");
    }

    // If setting as default, unset other defaults first
    if (data.isDefault) {
      await repo.collection.updateMany(
        { isDefault: true, _id: { $ne: oid } },
        { $set: { isDefault: false, updatedAt: new Date() } }
      );
    }

    const result = await repo.collection.updateOne(
      { _id: oid },
      { $set: { ...data, updatedAt: new Date() } }
    );

    if (!result.matchedCount) throw new NotFoundError("SSH key not found.");
    repo.delCachedData();
  }

  /**
   * Delete SSH key by ID
   */
  async function deleteById(id: string): Promise<void> {
    let oid: ObjectId;
    try {
      oid = new ObjectId(id);
    } catch {
      throw new BadRequestError("Invalid SSH key ID format.");
    }

    const result = await repo.collection.deleteOne({ _id: oid });
    if (!result.deletedCount) throw new NotFoundError("SSH key not found.");
    repo.delCachedData();
  }

  /**
   * Count SSH keys
   */
  async function count(): Promise<number> {
    return repo.collection.countDocuments({});
  }

  return {
    createIndexes,
    getAll,
    getById,
    getByName,
    getDefault,
    add,
    updateById,
    deleteById,
    count,
  };
}
