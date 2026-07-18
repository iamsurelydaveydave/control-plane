import crypto from "crypto";
import { execSync } from "child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { useSSHKeyRepo } from "./ssh-key.repository";
import { TSSHKey, TSSHKeyPublic, toPublicSSHKey } from "./ssh-key.model";

export function useSSHKeyService() {
  const repo = useSSHKeyRepo();

  /**
   * Generate a new SSH keypair
   */
  function generateKeyPair(type: "ed25519" | "rsa" = "ed25519"): {
    publicKey: string;
    privateKey: string;
    fingerprint: string;
  } {
    const tempDir = mkdtempSync(join(tmpdir(), "ssh-keygen-"));
    const keyPath = join(tempDir, "key");

    try {
      const keyType = type === "ed25519" ? "ed25519" : "rsa";
      const bits = type === "rsa" ? "-b 4096" : "";
      
      execSync(
        `ssh-keygen -t ${keyType} ${bits} -f "${keyPath}" -N "" -C "control-plane"`,
        { stdio: "pipe" }
      );

      const privateKey = readFileSync(keyPath, "utf-8");
      const publicKey = readFileSync(`${keyPath}.pub`, "utf-8").trim();
      
      // Generate fingerprint
      const fingerprintOutput = execSync(`ssh-keygen -lf "${keyPath}.pub"`, { encoding: "utf-8" });
      const fingerprint = fingerprintOutput.split(" ")[1];

      return { publicKey, privateKey, fingerprint };
    } finally {
      // Clean up temp files
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Calculate fingerprint from a public key
   */
  function getFingerprint(publicKey: string): string {
    const tempDir = mkdtempSync(join(tmpdir(), "ssh-fp-"));
    const keyPath = join(tempDir, "key.pub");

    try {
      writeFileSync(keyPath, publicKey);
      const output = execSync(`ssh-keygen -lf "${keyPath}"`, { encoding: "utf-8" });
      return output.split(" ")[1];
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Create a new SSH key (generate keypair).
   * Returns the full public key info AND the private key (only available at creation time).
   */
  async function create(
    name: string,
    type: "ed25519" | "rsa" = "ed25519",
    isDefault = false
  ): Promise<{ key: TSSHKeyPublic; privateKey: string }> {
    const { publicKey, privateKey, fingerprint } = generateKeyPair(type);

    const id = await repo.add({
      name,
      publicKey,
      privateKey,
      fingerprint,
      type,
      isDefault,
    });

    const key = await repo.getById(id);
    return {
      key: toPublicSSHKey(key!),
      privateKey, // Only returned at creation time
    };
  }

  /**
   * Import an existing SSH key
   */
  async function importKey(
    name: string,
    privateKey: string,
    isDefault = false
  ): Promise<TSSHKeyPublic> {
    // Extract public key from private key
    const tempDir = mkdtempSync(join(tmpdir(), "ssh-import-"));
    const keyPath = join(tempDir, "key");

    try {
      writeFileSync(keyPath, privateKey, { mode: 0o600 });
      
      const publicKey = execSync(`ssh-keygen -y -f "${keyPath}"`, { encoding: "utf-8" }).trim();
      const fingerprintOutput = execSync(`ssh-keygen -lf "${keyPath}"`, { encoding: "utf-8" });
      const fingerprint = fingerprintOutput.split(" ")[1];
      
      // Detect key type
      const type = privateKey.includes("BEGIN OPENSSH PRIVATE KEY") 
        ? (publicKey.startsWith("ssh-ed25519") ? "ed25519" : "rsa")
        : "rsa";

      const id = await repo.add({
        name,
        publicKey,
        privateKey,
        fingerprint,
        type,
        isDefault,
      });

      const key = await repo.getById(id);
      return toPublicSSHKey(key!);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Get all SSH keys (without private keys)
   */
  async function getAll(): Promise<TSSHKeyPublic[]> {
    const keys = await repo.getAll();
    return keys.map(toPublicSSHKey);
  }

  /**
   * Get SSH key by ID (without private key)
   */
  async function getById(id: string): Promise<TSSHKeyPublic | null> {
    const key = await repo.getById(id);
    return key ? toPublicSSHKey(key) : null;
  }

  /**
   * Get full SSH key by ID (including private key) - internal use only
   */
  async function getFullById(id: string): Promise<TSSHKey | null> {
    return repo.getById(id);
  }

  /**
   * Get default SSH key
   */
  async function getDefault(): Promise<TSSHKeyPublic | null> {
    const key = await repo.getDefault();
    return key ? toPublicSSHKey(key) : null;
  }

  /**
   * Get default SSH key with private key - internal use only
   */
  async function getDefaultFull(): Promise<TSSHKey | null> {
    return repo.getDefault();
  }

  /**
   * Update SSH key
   */
  async function update(id: string, data: { name?: string; isDefault?: boolean }): Promise<boolean> {
    return repo.updateById(id, data);
  }

  /**
   * Delete SSH key
   */
  async function deleteKey(id: string): Promise<boolean> {
    return repo.deleteById(id);
  }

  /**
   * Set a key as default
   */
  async function setDefault(id: string): Promise<boolean> {
    return repo.updateById(id, { isDefault: true });
  }

  return {
    generateKeyPair,
    getFingerprint,
    create,
    importKey,
    getAll,
    getById,
    getFullById,
    getDefault,
    getDefaultFull,
    update,
    deleteKey,
    setDefault,
  };
}
