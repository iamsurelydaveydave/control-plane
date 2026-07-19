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
import { useAppService } from "./resources/app/app.service";
import { useCaddyService } from "./services/caddy.service";
import {
  REDIS_HOST,
  REDIS_PORT,
  ROOT_USERNAME,
  ROOT_USER_EMAIL,
  ROOT_USER_PASSWORD,
  CADDY_ENABLED,
  CADDY_ADMIN_URL,
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

  // Initialize Caddy routing
  await initCaddyRouting();

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
  const userCount = await userRepo.count();
  if (userCount > 0) {
    logger.log({
      level: "debug",
      message: "Users already exist, skipping initial admin creation",
    });
    return;
  }

  // Check if this email already exists
  const existingUser = await userRepo.getByEmail(ROOT_USER_EMAIL);
  if (existingUser) {
    logger.log({
      level: "debug",
      message: "Admin user already exists, skipping",
    });
    return;
  }

  try {
    const hashedPassword = await hashPassword(ROOT_USER_PASSWORD);
    
    await userRepo.add({
      email: ROOT_USER_EMAIL,
      password: hashedPassword,
      role: "admin",
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

/**
 * Initialize Caddy reverse proxy routing.
 * Rebuilds routes from database state on startup.
 */
async function initCaddyRouting() {
  if (!CADDY_ENABLED) {
    logger.log({
      level: "info",
      message: "Caddy integration disabled (CADDY_ENABLED=false)",
    });
    return;
  }

  logger.log({
    level: "info",
    message: `Initializing Caddy routing (${CADDY_ADMIN_URL})...`,
  });

  const caddyService = useCaddyService();

  // Health check Caddy
  const health = await caddyService.healthCheck();
  if (!health.healthy) {
    logger.log({
      level: "warn",
      message: `Caddy not reachable: ${health.error || "unknown error"}. Routing will be synced when Caddy becomes available.`,
    });
    return;
  }

  // Rebuild all routes from database
  try {
    const appService = useAppService();
    await appService.rebuildAllRoutes();
    logger.log({
      level: "info",
      message: "Caddy routing initialized",
    });
  } catch (error) {
    logger.log({
      level: "error",
      message: `Failed to rebuild Caddy routes: ${error}`,
    });
  }
}
