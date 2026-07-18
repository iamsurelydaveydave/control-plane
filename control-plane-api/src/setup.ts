import { logger, useRedis, hashPassword } from "./utils";
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
  ROOT_USERNAME,
  ROOT_USER_EMAIL,
  ROOT_USER_PASSWORD,
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

  // Create initial admin user if configured
  await createInitialAdminUser();

  logger.log({
    level: "info",
    message: "Setup complete",
  });
}

/**
 * Create the initial admin user from environment variables.
 * This is set by the install script during onboarding.
 */
async function createInitialAdminUser() {
  if (!ROOT_USER_EMAIL || !ROOT_USER_PASSWORD) {
    logger.log({
      level: "debug",
      message: "No initial admin credentials configured, skipping",
    });
    return;
  }

  const userRepo = useUserRepo();
  
  // Check if any users exist
  const existingUsers = await userRepo.findAll({ limit: 1 });
  if (existingUsers.length > 0) {
    logger.log({
      level: "debug",
      message: "Users already exist, skipping initial admin creation",
    });
    return;
  }

  // Check if this email already exists
  const existingUser = await userRepo.findByEmail(ROOT_USER_EMAIL);
  if (existingUser) {
    logger.log({
      level: "debug",
      message: "Admin user already exists, skipping",
    });
    return;
  }

  try {
    const hashedPassword = await hashPassword(ROOT_USER_PASSWORD);
    
    await userRepo.create({
      name: ROOT_USERNAME || "Admin",
      email: ROOT_USER_EMAIL,
      password: hashedPassword,
      role: "admin",
      status: "active",
    });

    logger.log({
      level: "info",
      message: `Initial admin user created: ${ROOT_USER_EMAIL}`,
    });
  } catch (error) {
    logger.log({
      level: "error",
      message: `Failed to create initial admin user: ${error}`,
    });
  }
}
