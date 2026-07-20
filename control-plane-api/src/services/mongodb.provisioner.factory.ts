import { useMongoDBProvisioner } from "./mongodb.provisioner";
import { useMongoDBProvisionerK8s } from "./mongodb.provisioner.k8s";
import { useDatabaseRepo, TDatabase } from "../resources/database";
import { logger } from "../utils";

export type TProvisionerType = "ansible" | "k8s";

/**
 * Smart MongoDB Provisioner Factory
 * 
 * Routes operations to the correct provisioner based on:
 * 1. For new databases: uses K8S_ENABLED env var to decide
 * 2. For existing databases: uses the `provisionedWith` field to route
 *    to the same provisioner that created the database
 * 
 * This allows gradual migration from Ansible to K8s:
 * - Old databases (provisionedWith: 'ansible' or undefined) use Ansible
 * - New databases (when K8S_ENABLED=true) use K8s and are marked accordingly
 */
export function useSmartMongoDBProvisioner() {
  const ansibleProvisioner = useMongoDBProvisioner();
  const k8sProvisioner = useMongoDBProvisionerK8s();
  const databaseRepo = useDatabaseRepo();

  /**
   * Get the current default provisioner type based on environment
   */
  function getDefaultProvisionerType(): TProvisionerType {
    return process.env.K8S_ENABLED === "true" ? "k8s" : "ansible";
  }

  /**
   * Get the provisioner type for an existing database
   * Falls back to 'ansible' for databases created before this field existed
   */
  async function getProvisionerForDatabase(databaseId: string): Promise<TProvisionerType> {
    const database = await databaseRepo.getById(databaseId);
    if (!database) {
      // Database not found, use default
      return getDefaultProvisionerType();
    }
    // If provisionedWith is set, use it; otherwise assume ansible (legacy)
    return database.provisionedWith || "ansible";
  }

  /**
   * Get the appropriate provisioner instance
   */
  function getProvisioner(type: TProvisionerType) {
    return type === "k8s" ? k8sProvisioner : ansibleProvisioner;
  }

  /**
   * Provision a new database
   * Uses the default provisioner and marks the database with which one was used
   */
  async function provision(options: {
    databaseId: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = getDefaultProvisionerType();
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Provisioning ${options.databaseId} with ${provisionerType}`,
    });

    // Mark the database with the provisioner type BEFORE provisioning
    await databaseRepo.updateById(options.databaseId, {
      provisionedWith: provisionerType,
    });

    const result = await provisioner.provision(options);

    return result;
  }

  /**
   * Remove a database
   * Routes to the provisioner that originally created it
   */
  async function remove(
    databaseId: string,
    keepData?: boolean,
    onLog?: (line: string) => void
  ) {
    const provisionerType = await getProvisionerForDatabase(databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Removing ${databaseId} with ${provisionerType}`,
    });

    return provisioner.remove(databaseId, keepData, onLog);
  }

  /**
   * Get health of a database
   * Routes to the provisioner that originally created it
   */
  async function getHealth(databaseId: string) {
    const provisionerType = await getProvisionerForDatabase(databaseId);
    const provisioner = getProvisioner(provisionerType);

    return provisioner.getHealth(databaseId);
  }

  /**
   * Add a node to a database
   * Routes to the provisioner that originally created it
   */
  async function addNode(options: {
    databaseId: string;
    serverId: string;
    role: "secondary" | "arbiter";
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = await getProvisionerForDatabase(options.databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Adding node to ${options.databaseId} with ${provisionerType}`,
    });

    return provisioner.addNode(options);
  }

  /**
   * Remove a node from a database
   * Routes to the provisioner that originally created it
   */
  async function removeNode(options: {
    databaseId: string;
    serverId: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = await getProvisionerForDatabase(options.databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Removing node from ${options.databaseId} with ${provisionerType}`,
    });

    return provisioner.removeNode(options);
  }

  /**
   * Configure TLS on a database
   * Routes to the provisioner that originally created it
   */
  async function configureTLS(options: {
    databaseId: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = await getProvisionerForDatabase(options.databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Configuring TLS on ${options.databaseId} with ${provisionerType}`,
    });

    return provisioner.configureTLS(options);
  }

  /**
   * Configure DNS for a database
   * Routes to the provisioner that originally created it
   */
  async function configureDNS(databaseId: string) {
    const provisionerType = await getProvisionerForDatabase(databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Configuring DNS on ${databaseId} with ${provisionerType}`,
    });

    return provisioner.configureDNS(databaseId);
  }

  /**
   * Backup a database
   * Routes to the provisioner that originally created it
   */
  async function backup(options: {
    databaseId: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = await getProvisionerForDatabase(options.databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Backing up ${options.databaseId} with ${provisionerType}`,
    });

    return provisioner.backup(options);
  }

  /**
   * Restore a database
   * Routes to the provisioner that originally created it
   */
  async function restore(options: {
    databaseId: string;
    s3Key: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }) {
    const provisionerType = await getProvisionerForDatabase(options.databaseId);
    const provisioner = getProvisioner(provisionerType);

    logger.log({
      level: "info",
      message: `[SmartProvisioner] Restoring ${options.databaseId} with ${provisionerType}`,
    });

    return provisioner.restore(options);
  }

  return {
    provision,
    remove,
    getHealth,
    addNode,
    removeNode,
    configureTLS,
    configureDNS,
    backup,
    restore,
    // Expose utility functions
    getDefaultProvisionerType,
    getProvisionerForDatabase,
  };
}

/**
 * Get the MongoDB provisioner (smart router version)
 * This is the main entry point for database operations
 */
export function getMongoDBProvisioner() {
  return useSmartMongoDBProvisioner();
}

/**
 * Check which provisioner is currently the default for new databases
 */
export function getProvisionerType(): TProvisionerType {
  return process.env.K8S_ENABLED === "true" ? "k8s" : "ansible";
}
