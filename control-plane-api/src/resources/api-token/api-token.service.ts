import crypto from "crypto";
import { ObjectId } from "mongodb";
import { useAPITokenRepo } from "./api-token.repository";
import { TAPIToken, TAPITokenPublic, TAPITokenScope, toPublicAPIToken } from "./api-token.model";

export function useAPITokenService() {
  const repo = useAPITokenRepo();

  /**
   * Generate a random API token
   * Format: cp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx (35 chars total: 3 prefix + 32 random)
   */
  function generateToken(): string {
    const randomPart = crypto.randomBytes(24).toString("base64url");
    return `cp_${randomPart}`;
  }

  /**
   * Hash a token for storage using SHA256.
   * Note: We use SHA256 instead of bcrypt because API tokens are high-entropy
   * random strings (not user-chosen passwords), so rainbow tables and brute-force
   * attacks aren't practical. SHA256 also enables O(1) lookup by hash.
   */
  function hashToken(plainToken: string): string {
    return crypto.createHash("sha256").update(plainToken).digest("hex");
  }

  /**
   * Create a new API token.
   * Returns the full token only once — it cannot be retrieved later.
   */
  async function create(
    userId: string,
    name: string,
    scopes: TAPITokenScope[] = ["*"],
    expiresAt?: Date
  ): Promise<{ token: TAPITokenPublic; plainToken: string }> {
    const plainToken = generateToken();
    const tokenPrefix = plainToken.substring(0, 8); // "cp_xxxxx"
    const hashedToken = hashToken(plainToken);

    const id = await repo.add({
      name,
      token: hashedToken,
      tokenPrefix,
      userId: new ObjectId(userId),
      scopes,
      expiresAt,
    });

    const token = await repo.getById(id);
    return {
      token: toPublicAPIToken(token!),
      plainToken,
    };
  }

  /**
   * Validate a plain API token string and return the full token record if valid.
   * Updates lastUsedAt on successful validation.
   */
  async function validateToken(plainToken: string): Promise<TAPIToken | null> {
    if (!plainToken || !plainToken.startsWith("cp_")) {
      return null;
    }

    const hashedToken = hashToken(plainToken);
    const token = await repo.getByToken(hashedToken);

    if (!token) {
      return null;
    }

    // Check expiration
    if (token.expiresAt && new Date() > token.expiresAt) {
      return null;
    }

    // Update last used timestamp (fire-and-forget)
    repo.updateLastUsed(token._id!).catch(() => {
      // Ignore — non-critical
    });

    return token;
  }

  /**
   * Get all tokens for a user (without the actual token values)
   */
  async function getAllForUser(userId: string): Promise<TAPITokenPublic[]> {
    const tokens = await repo.getAllByUser(userId);
    return tokens.map(toPublicAPIToken);
  }

  /**
   * Delete a token by ID
   */
  async function deleteToken(id: string): Promise<boolean> {
    return repo.deleteById(id);
  }

  /**
   * Delete all tokens for a user
   */
  async function deleteAllForUser(userId: string): Promise<number> {
    return repo.deleteAllByUser(userId);
  }

  /**
   * Check if a token has a specific scope
   */
  function hasScope(token: TAPIToken, scope: TAPITokenScope): boolean {
    if (token.scopes.includes("*")) {
      return true;
    }
    return token.scopes.includes(scope);
  }

  return {
    generateToken,
    hashToken,
    create,
    validateToken,
    getAllForUser,
    deleteToken,
    deleteAllForUser,
    hasScope,
  };
}
