import crypto from "crypto";
import { execSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { useSSHKeyRepo } from "./ssh-key.repository";
import { modelSSHKey, TSSHKey, TSSHKeyType, TSSHKeyResponse, sshKeyToResponse } from "./ssh-key.model";
import { BadRequestError, NotFoundError } from "../../utils/error";
import { logger } from "../../utils";

/**
 * SSH Key Service - handles key generation, import, and management
 */
export function useSSHKeyService() {
  const repo = useSSHKeyRepo();

  /**
   * Generate an SSH keypair using system ssh-keygen
   * Returns the raw key material (not stored in DB)
   */
  function generateKeyPair(type: TSSHKeyType): {
    publicKey: string;
    privateKey: string;
    fingerprint: string;
  } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-keygen-"));
    const keyPath = path.join(tmpDir, "id_key");

    try {
      // Generate the key using ssh-keygen
      const keygenArgs = type === "ed25519"
        ? `-t ed25519 -f "${keyPath}" -N "" -C "control-plane"`
        : `-t rsa -b 4096 -f "${keyPath}" -N "" -C "control-plane"`;

      execSync(`ssh-keygen ${keygenArgs}`, { stdio: "pipe" });

      // Read the generated keys
      const privateKey = fs.readFileSync(keyPath, "utf-8");
      const publicKey = fs.readFileSync(`${keyPath}.pub`, "utf-8").trim();

      // Get fingerprint
      const fingerprintOutput = execSync(`ssh-keygen -lf "${keyPath}.pub"`, { encoding: "utf-8" });
      // Format: "256 SHA256:xxxx comment (ED25519)" - extract SHA256:xxxx
      const match = fingerprintOutput.match(/SHA256:[^\s]+/);
      const fingerprint = match ? match[0] : generateFingerprint(publicKey);

      return { publicKey, privateKey, fingerprint };
    } finally {
      // Clean up temp files
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Extract public key from a private key using ssh-keygen
   */
  function extractPublicKey(privateKey: string): {
    publicKey: string;
    fingerprint: string;
    type: TSSHKeyType;
  } {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ssh-extract-"));
    const keyPath = path.join(tmpDir, "id_key");

    try {
      // Write private key to temp file
      fs.writeFileSync(keyPath, privateKey, { mode: 0o600 });

      // Extract public key
      const publicKey = execSync(`ssh-keygen -y -f "${keyPath}"`, { encoding: "utf-8" }).trim();

      // Get fingerprint
      const pubKeyPath = `${keyPath}.pub`;
      fs.writeFileSync(pubKeyPath, publicKey);
      const fingerprintOutput = execSync(`ssh-keygen -lf "${pubKeyPath}"`, { encoding: "utf-8" });
      const match = fingerprintOutput.match(/SHA256:[^\s]+/);
      const fingerprint = match ? match[0] : generateFingerprint(publicKey);

      // Detect key type from public key
      let type: TSSHKeyType = "rsa";
      if (publicKey.startsWith("ssh-ed25519")) {
        type = "ed25519";
      }

      return { publicKey, fingerprint, type };
    } catch (error: any) {
      throw new BadRequestError(
        "Invalid private key format. Please provide a valid OpenSSH private key."
      );
    } finally {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup errors
      }
    }
  }

  /**
   * Generate a fingerprint from a public key (fallback)
   */
  function generateFingerprint(publicKey: string): string {
    const hash = crypto.createHash("sha256").update(publicKey).digest("base64");
    return `SHA256:${hash.replace(/=+$/, "")}`;
  }

  /**
   * Create a new SSH key (generates keypair and stores)
   * Returns the key metadata and the private key (one time only)
   */
  async function create(
    name: string,
    type: TSSHKeyType,
    isDefault: boolean = false
  ): Promise<{ key: TSSHKeyResponse; privateKey: string }> {
    // Check if name already exists
    const existing = await repo.getByName(name).catch(() => null);
    if (existing) {
      throw new BadRequestError(`SSH key with name '${name}' already exists.`);
    }

    // Generate keypair
    const { publicKey, privateKey, fingerprint } = generateKeyPair(type);

    // Create the key model
    const keyData = modelSSHKey({
      name,
      publicKey,
      privateKey,
      fingerprint,
      type,
      isDefault,
    });

    // Store in database
    const id = await repo.add(keyData);

    logger.log({
      level: "info",
      message: `SSH key created: ${name} (${type})`,
    });

    // Return the response (without private key) plus the private key separately
    const storedKey = { ...keyData, _id: id } as any;
    const response = sshKeyToResponse(storedKey);

    return { key: response, privateKey };
  }

  /**
   * Import an existing private key
   */
  async function importKey(
    name: string,
    privateKey: string,
    isDefault: boolean = false
  ): Promise<TSSHKeyResponse> {
    // Check if name already exists
    const existingByName = await repo.getByName(name).catch(() => null);
    if (existingByName) {
      throw new BadRequestError(`SSH key with name '${name}' already exists.`);
    }

    // Extract public key and determine type
    const { publicKey, fingerprint, type } = extractPublicKey(privateKey);

    // Create the key model
    const keyData = modelSSHKey({
      name,
      publicKey,
      privateKey,
      fingerprint,
      type,
      isDefault,
    });

    // Store in database
    const id = await repo.add(keyData);

    logger.log({
      level: "info",
      message: `SSH key imported: ${name} (${type})`,
    });

    const storedKey = { ...keyData, _id: id } as any;
    return sshKeyToResponse(storedKey);
  }

  /**
   * Get all SSH keys (public info only)
   */
  async function getAll(): Promise<TSSHKeyResponse[]> {
    const keys = await repo.getAll();
    return keys.map(sshKeyToResponse);
  }

  /**
   * Get an SSH key by ID (public info only)
   */
  async function getById(id: string): Promise<TSSHKeyResponse | null> {
    try {
      const key = await repo.getById(id);
      return sshKeyToResponse(key);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the full SSH key with private key (for internal use only)
   */
  async function getFullById(id: string): Promise<TSSHKey | null> {
    try {
      return await repo.getById(id);
    } catch (error) {
      if (error instanceof NotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Get the default SSH key (for internal use)
   */
  async function getDefault(): Promise<TSSHKeyResponse | null> {
    const key = await repo.getDefault();
    return key ? sshKeyToResponse(key) : null;
  }

  /**
   * Get the default SSH key with private key (for internal provisioning)
   */
  async function getDefaultFull(): Promise<TSSHKey | null> {
    return repo.getDefault();
  }

  /**
   * Set a key as the default
   */
  async function setDefault(id: string): Promise<boolean> {
    await repo.updateById(id, { isDefault: true });
    return true;
  }

  /**
   * Update an SSH key
   */
  async function update(
    id: string,
    data: { name?: string; isDefault?: boolean }
  ): Promise<boolean> {
    // If changing name, check for conflicts
    if (data.name) {
      const existing = await repo.getByName(data.name).catch(() => null);
      if (existing && existing._id?.toString() !== id) {
        throw new BadRequestError(`SSH key with name '${data.name}' already exists.`);
      }
    }

    await repo.updateById(id, data);
    return true;
  }

  /**
   * Delete an SSH key
   */
  async function deleteKey(id: string): Promise<boolean> {
    await repo.deleteById(id);
    logger.log({
      level: "info",
      message: `SSH key deleted: ${id}`,
    });
    return true;
  }

  /**
   * Count SSH keys
   */
  async function count(): Promise<number> {
    return repo.count();
  }

  return {
    generateKeyPair,
    extractPublicKey,
    create,
    importKey,
    getAll,
    getById,
    getFullById,
    getDefault,
    getDefaultFull,
    setDefault,
    update,
    deleteKey,
    count,
  };
}
