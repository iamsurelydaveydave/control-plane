import { useRedis } from "./ioredis";
import { logger } from "./logger";

const SESSION_PREFIX = "session:";

export type TSessionPrincipal = {
  userId: string;
  email?: string;
  createdAt: number;
};

export function useSessionStore() {
  const redis = useRedis().getClient();

  async function set(
    sid: string,
    principal: TSessionPrincipal,
    ttlSeconds: number
  ): Promise<void> {
    try {
      await redis.set(
        `${SESSION_PREFIX}${sid}`,
        JSON.stringify(principal),
        "EX",
        ttlSeconds
      );
    } catch (err) {
      logger.log({
        level: "error",
        message: `Failed to set session ${sid}: ${err}`,
      });
      throw err;
    }
  }

  async function get(sid: string): Promise<TSessionPrincipal | null> {
    try {
      const data = await redis.get(`${SESSION_PREFIX}${sid}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      logger.log({
        level: "error",
        message: `Failed to get session ${sid}: ${err}`,
      });
      return null;
    }
  }

  async function destroy(sid: string): Promise<void> {
    try {
      await redis.del(`${SESSION_PREFIX}${sid}`);
    } catch (err) {
      logger.log({
        level: "error",
        message: `Failed to destroy session ${sid}: ${err}`,
      });
    }
  }

  async function touch(sid: string, ttlSeconds: number, userId: string): Promise<void> {
    try {
      const existing = await get(sid);
      if (existing && existing.userId === userId) {
        await redis.expire(`${SESSION_PREFIX}${sid}`, ttlSeconds);
      }
    } catch (err) {
      logger.log({
        level: "error",
        message: `Failed to touch session ${sid}: ${err}`,
      });
    }
  }

  return {
    set,
    get,
    destroy,
    touch,
  };
}

export function sessionUserId(principal: TSessionPrincipal | null): string | null {
  return principal?.userId ?? null;
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
