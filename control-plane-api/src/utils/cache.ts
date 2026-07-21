import { useRedis } from "./ioredis";
import { recordCacheHit, recordCacheMiss } from "./prometheus";

const DEFAULT_TTL = 300; // 5 minutes

export function useCache(namespace = "default") {
  const getRedis = () => useRedis().getClient();

  async function getCache<T = unknown>(key: string): Promise<T | null> {
    try {
      const cached = await getRedis().get(key);
      if (cached) {
        recordCacheHit();
        return JSON.parse(cached) as T;
      }
      recordCacheMiss();
      return null;
    } catch (err) {
      console.warn(`[Cache][Get] Error: ${err instanceof Error ? err.message : err}`);
      recordCacheMiss();
      return null;
    }
  }

  async function setCache<T = unknown>(key: string, value: T, ttl: number = DEFAULT_TTL): Promise<void> {
    try {
      await getRedis().set(key, JSON.stringify(value), "EX", ttl);
      if (namespace) {
        const nsKey = `cache:ns:${namespace}`;
        await getRedis().sadd(nsKey, key);
        const currentTtl = await getRedis().ttl(nsKey);
        const nsTtl = Math.max(ttl, currentTtl > 0 ? currentTtl : 0);
        await getRedis().expire(nsKey, nsTtl);
      }
    } catch (err) {
      console.warn(`[Cache][Set] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function delCache(key: string): Promise<void> {
    try {
      await getRedis().del(key);
    } catch (err) {
      console.warn(`[Cache][Del] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  async function delNamespace(): Promise<void> {
    try {
      const nsKey = `cache:ns:${namespace}`;
      const keys = await getRedis().smembers(nsKey);
      if (keys.length) {
        const CHUNK = 500;
        for (let i = 0; i < keys.length; i += CHUNK) {
          await getRedis().unlink(...keys.slice(i, i + CHUNK));
        }
      }
      await getRedis().unlink(nsKey);
    } catch (err) {
      console.warn(`[Cache][DelNS] Error: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    getCache,
    setCache,
    delCache,
    delNamespace,
  };
}
