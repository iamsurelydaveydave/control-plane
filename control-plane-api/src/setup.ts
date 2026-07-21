import { logger, useRedis, hashPassword } from "./utils";
import {
  useUserRepo,
  useAppRepo,
  useDeploymentRepo,
  useDeploymentApprovalRepo,
  useAuditLogRepo,
  useSettingsRepo,
  useAPITokenRepo,
  useClusterRepo,
  useClusterService,
  useNodeRepo,
  useSSHKeyRepo,
  useDatabaseRepo,
  useAlertRepo,
  useRoleRepo,
  useRoleService,
  useWebhookRepo,
  useScheduledTaskRepo,
  useTaskHistoryRepo,
  useOrganizationRepo,
  useOrganizationMemberRepo,
  useOrganizationInviteRepo,
  useAddonRepo,
  useRegistryRepo,
  useSSOConfigRepo,
  usePipelineRepo,
  usePromotionRepo,
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
    { name: "app", repo: useAppRepo() },
    { name: "deployment", repo: useDeploymentRepo() },
    { name: "deploymentApproval", repo: useDeploymentApprovalRepo() },
    { name: "auditLog", repo: useAuditLogRepo() },
    { name: "settings", repo: useSettingsRepo() },
    { name: "apiToken", repo: useAPITokenRepo() },
    { name: "role", repo: useRoleRepo() },
    // K8s-native resources
    { name: "cluster", repo: useClusterRepo() },
    { name: "node", repo: useNodeRepo() },
    { name: "sshKey", repo: useSSHKeyRepo() },
    { name: "database", repo: useDatabaseRepo() },
    { name: "alert", repo: useAlertRepo() },
    // Webhooks & tasks
    { name: "webhook", repo: useWebhookRepo() },
    { name: "scheduledTask", repo: useScheduledTaskRepo() },
    { name: "taskHistory", repo: useTaskHistoryRepo() },
    // Organizations (multi-tenancy)
    { name: "organization", repo: useOrganizationRepo() },
    { name: "organizationMember", repo: useOrganizationMemberRepo() },
    { name: "organizationInvite", repo: useOrganizationInviteRepo() },
    // Addons (Helm-deployed services)
    { name: "addon", repo: useAddonRepo() },
    // Container Registries
    { name: "registry", repo: useRegistryRepo() },
    // SSO (Single Sign-On) configs
    { name: "ssoConfig", repo: useSSOConfigRepo() },
    // Pipelines (deployment stages and promotions)
    { name: "pipeline", repo: usePipelineRepo() },
    { name: "promotion", repo: usePromotionRepo() },
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
 * Seed default roles on first run.
 */
async function seedDefaultRoles() {
  try {
    const roleRepo = useRoleRepo();
    const result = await roleRepo.seedDefaultRoles();
    
    if (result.created > 0) {
      logger.log({
        level: "info",
        message: `Seeded ${result.created} default roles (${result.skipped} already existed)`,
      });
    }
  } catch (error) {
    logger.log({
      level: "error",
      message: `Failed to seed default roles: ${error}`,
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

  // Seed default roles (must run before creating initial admin user)
  await seedDefaultRoles();

  // Create initial admin user if configured
  await createInitialAdminUser();

  // Initialize local K8s cluster
  await initLocalCluster();

  logger.log({
    level: "info",
    message: "Setup complete",
  });
}

/**
 * Initialize the local Kubernetes cluster.
 * Creates the cluster record in DB and syncs status.
 */
async function initLocalCluster() {
  try {
    const clusterService = useClusterService();
    await clusterService.initLocalCluster();
    logger.log({
      level: "info",
      message: "Local K8s cluster initialized",
    });
  } catch (error) {
    logger.log({
      level: "warn",
      message: `Failed to initialize local K8s cluster: ${error}. This is expected if not running on K8s.`,
    });
  }
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
  const roleService = useRoleService();
  
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
    
    // Get the admin role ID
    const adminRoleId = await roleService.getAdminRoleId();
    
    await userRepo.add({
      email: ROOT_USER_EMAIL,
      password: hashedPassword,
      role: "admin",
      roleId: adminRoleId ? new (require("mongodb").ObjectId)(adminRoleId) : undefined,
    });

    logger.log({
      level: "info",
      message: `Initial admin user created: ${ROOT_USER_EMAIL}${adminRoleId ? " with admin role" : ""}`,
    });
  } catch (error) {
    logger.log({
      level: "error",
      message: `Failed to create initial admin user: ${error}`,
    });
  }
}
