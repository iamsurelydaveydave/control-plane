import Redis from "ioredis";
import { REDIS_URL, REDIS_HOST, REDIS_PORT, REDIS_PASSWORD } from "../config";
import { logger } from "./logger";
import { setRedisStatus } from "./prometheus";

let redisClient: Redis | null = null;

export function useRedis() {
  function getClient(): Redis {
    if (!redisClient) {
      // Use REDIS_URL if provided (e.g., from Upstash), otherwise use separate params
      if (REDIS_URL) {
        redisClient = new Redis(REDIS_URL, {
          retryStrategy: (times) => {
            if (times > 3) {
              logger.log({
                level: "error",
                message: `Redis connection failed after ${times} attempts`,
              });
              return null;
            }
            return Math.min(times * 100, 3000);
          },
        });
      } else {
        redisClient = new Redis({
          host: REDIS_HOST || "localhost",
          port: REDIS_PORT || 6379,
          password: REDIS_PASSWORD || undefined,
          retryStrategy: (times) => {
            if (times > 3) {
              logger.log({
                level: "error",
                message: `Redis connection failed after ${times} attempts`,
              });
              return null;
            }
            return Math.min(times * 100, 3000);
          },
        });
      }

      redisClient.on("connect", () => {
              logger.log({
                level: "info",
                message: "Redis connected",
              });
              setRedisStatus(true);
            });

            redisClient.on("error", (err) => {
              logger.log({
                level: "error",
                message: `Redis error: ${err.message}`,
              });
              setRedisStatus(false);
            });

            redisClient.on("close", () => {
              setRedisStatus(false);
            });
    }

    return redisClient;
  }

  async function disconnect(): Promise<void> {
    if (redisClient) {
      await redisClient.quit();
      redisClient = null;
      logger.log({
        level: "info",
        message: "Redis disconnected",
      });
    }
  }

  return {
    getClient,
    disconnect,
  };
}
