import { logger, useRedis } from "./utils";
import {
  useUserRepo,
  useServerRepo,
  useAppRepo,
  useDatabaseRepo,
  useInstanceRepo,
  useDeploymentRepo,
  useAuditLogRepo,
  useSettingsRepo,
  useSSHKeyRepo,
  useAPITokenRepo,
} from "./resources";
import {
  REDIS_HOST,
  REDIS_PORT,
} from "./config";

/**
 * Create all MongoDB indexes for all repositories.
 * This is called on server startup and ensures proper index coverage.
 */
export async function createAllIndexes() {
  const repositories = [
    { name: "user", repo: useUserRepo() },
    { name: "server", repo: useServerRepo() },
    { name: "app", repo: useAppRepo() },
    { name: "database", repo: useDatabaseRepo() },
    { name: "instance", repo: useInstanceRepo() },
    { name: "deployment", repo: useDeploymentRepo() },
    { name: "auditLog", repo: useAuditLogRepo() },
    { name: "settings", repo: useSettingsRepo() },
    { name: "sshKey", repo: useSSHKeyRepo() },
    { name: "apiToken", repo: useAPITokenRepo() },
  ];

  for (const { name, repo } of repositories) {
    try {
      if (repo.createIndexes) {
        await repo.createIndexes();
        logger.log({
          level: "info",
          message: `Created indexes for ${name}`,
        });
      }
    } catch (error) {
      logger.log({
        level: "error",
        message: `Failed to create indexes for ${name}: ${error}`,
      });
    }
  }
}

/**
 * Initialize Redis connection.
 */
async function initRedis() {
  try {
    const redis = useRedis();
    const client = redis.getClient();
    
    // Test connection
    await client.ping();
    
    logger.log({
      level: "info",
      message: `Redis connected to ${REDIS_HOST}:${REDIS_PORT}`,
    });
  } catch (error) {
    logger.log({
      level: "warn",
      message: `Redis connection failed (caching disabled): ${error}`,
    });
  }
}

/**
 * Main setup function called on server startup.
 */
export default async function setup() {
  logger.log({
    level: "info",
    message: "Running setup...",
  });

  // Initialize Redis
  await initRedis();

  // Create all indexes
  await createAllIndexes();

  logger.log({
    level: "info",
    message: "Setup complete",
  });
}
