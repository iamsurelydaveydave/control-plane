import { ObjectId } from "mongodb";
import { useAnsibleExecutor } from "./ansible.executor";
import { useServerRepo } from "../resources/server";
import { useDatabaseRepo, TDatabase, TDatabaseNode } from "../resources/database";
import { useDeploymentRepo } from "../resources/deployment";
import { logger, InternalServerError, BadRequestError, NotFoundError } from "../utils";

export type TMongoDBProvisionOptions = {
  databaseId: string;
  triggeredBy: string;
  onLog?: (line: string) => void;
};

export type TProvisionResult = {
  success: boolean;
  connectionString?: string;
  error?: string;
  logs: string[];
};

/**
 * MongoDB Provisioning Service
 * Orchestrates MongoDB deployment via Ansible
 */
export function useMongoDBProvisioner() {
  const ansible = useAnsibleExecutor();
  const serverRepo = useServerRepo();
  const databaseRepo = useDatabaseRepo();
  const deploymentRepo = useDeploymentRepo();

  /**
   * Provision a MongoDB instance (standalone or replica set)
   */
  async function provision(options: TMongoDBProvisionOptions): Promise<TProvisionResult> {
    const { databaseId, triggeredBy, onLog } = options;
    const logs: string[] = [];

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB Provision] ${line}` });
    };

    try {
      // Check Ansible is available
      const ansibleInstalled = await ansible.checkAnsibleInstalled();
      if (!ansibleInstalled) {
        throw new InternalServerError("Ansible is not installed on this server");
      }

      // Get database configuration
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      if (database.type !== "mongodb") {
        throw new BadRequestError("This provisioner only supports MongoDB");
      }

      log(`Starting MongoDB provisioning for: ${database.name}`);
      log(`Version: ${database.version}`);
      log(`Mode: ${database.nodes.length > 1 ? "replica set" : "standalone"}`);

      // Get server details for all nodes
      const servers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) {
            throw new NotFoundError(`Server not found: ${node.serverId}`);
          }
          return { server, node };
        })
      );

      log(`Servers: ${servers.map((s) => s.server.host).join(", ")}`);

      // Update database status to provisioning
      await databaseRepo.updateStatus(databaseId, "provisioning");

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: new ObjectId(databaseId), // Reusing appId field for database
        image: `mongo:${database.version}`,
        triggeredBy: new ObjectId(triggeredBy),
      });

      await deploymentRepo.updateStatus(deploymentId, "running");

      // Determine provisioning mode
      const isReplicaSet = database.nodes.length > 1;
      const playbook = isReplicaSet ? "mongodb-replicaset.yml" : "mongodb-standalone.yml";

      // Build inventory
      let inventoryContent: string;
      if (isReplicaSet) {
        inventoryContent = buildReplicaSetInventory(servers, database);
      } else {
        inventoryContent = buildStandaloneInventory(servers[0], database);
      }

      log("Generated inventory:");
      log(inventoryContent);

      // Write inventory file
      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      // Build extra vars
      const extraVars = buildExtraVars(database, isReplicaSet);

      log("Starting Ansible playbook execution...");

      // Execute playbook
      const result = await ansible.execPlaybook(
        {
          playbook,
          inventory: inventoryPath,
          extraVars,
          verbose: true,
        },
        log
      );

      // Update deployment with logs
      await deploymentRepo.updateStatus(
        deploymentId,
        result.success ? "success" : "failed",
        result.stdout + "\n" + result.stderr
      );

      if (result.success) {
        // Build connection string
        const connectionString = buildConnectionString(database, servers);

        // Update database with connection string and running status
        await databaseRepo.updateById(databaseId, {
          status: "running",
          credentials: {
            ...database.credentials,
            connectionString,
          },
        });

        // Update node statuses
        for (const { node } of servers) {
          node.status = "running";
        }
        await databaseRepo.updateById(databaseId, {
          nodes: database.nodes,
        });

        log("MongoDB provisioning completed successfully!");
        log(`Connection string: ${maskPassword(connectionString)}`);

        return {
          success: true,
          connectionString,
          logs,
        };
      } else {
        // Update database status to failed
        await databaseRepo.updateStatus(databaseId, "failed");

        log("MongoDB provisioning failed!");
        log(result.stderr);

        return {
          success: false,
          error: result.stderr || "Ansible playbook failed",
          logs,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      
      // Update database status to failed
      await databaseRepo.updateStatus(databaseId, "failed").catch(() => {});

      return {
        success: false,
        error: error.message,
        logs,
      };
    }
  }

  /**
   * Remove a MongoDB deployment
   */
  async function remove(
    databaseId: string,
    removeData: boolean = false,
    onLog?: (line: string) => void
  ): Promise<TProvisionResult> {
    const logs: string[] = [];

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB Remove] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log(`Removing MongoDB deployment: ${database.name}`);

      // Get server details
      const servers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) {
            throw new NotFoundError(`Server not found: ${node.serverId}`);
          }
          return { server, node };
        })
      );

      // Build inventory
      const inventoryContent = buildRemoveInventory(servers, database);
      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      // Execute remove playbook
      const result = await ansible.execPlaybook(
        {
          playbook: "mongodb-remove.yml",
          inventory: inventoryPath,
          extraVars: {
            mongodb_container_name: `mongodb_${database.name}`,
            remove_data: removeData,
          },
          verbose: true,
        },
        log
      );

      if (result.success) {
        // Update database status
        await databaseRepo.updateStatus(databaseId, "stopped");
        
        // Update node statuses
        for (const { node } of servers) {
          node.status = "stopped";
        }
        await databaseRepo.updateById(databaseId, {
          nodes: database.nodes,
        });

        log("MongoDB removal completed successfully!");
      }

      return {
        success: result.success,
        error: result.success ? undefined : result.stderr,
        logs,
      };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs,
      };
    }
  }

  return {
    provision,
    remove,
  };
}

// Helper functions

function buildStandaloneInventory(
  serverData: { server: any; node: TDatabaseNode },
  database: TDatabase
): string {
  const { server, node } = serverData;
  const hostname = server.host.replace(/\./g, "_");

  return `[mongodb]
${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}

[all:vars]
ansible_python_interpreter=/usr/bin/python3
`;
}

function buildReplicaSetInventory(
  servers: Array<{ server: any; node: TDatabaseNode }>,
  database: TDatabase
): string {
  const lines: string[] = [];

  // Group by role
  const primary = servers.filter((s) => s.node.role === "primary");
  const secondary = servers.filter((s) => s.node.role === "secondary");
  const arbiter = servers.filter((s) => s.node.role === "arbiter");

  // Primary group
  lines.push("[mongodb_primary]");
  for (const { server, node } of primary) {
    const hostname = server.host.replace(/\./g, "_");
    lines.push(
      `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
    );
  }
  lines.push("");

  // Secondary group
  if (secondary.length > 0) {
    lines.push("[mongodb_secondary]");
    for (const { server, node } of secondary) {
      const hostname = server.host.replace(/\./g, "_");
      lines.push(
        `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
      );
    }
    lines.push("");
  }

  // Arbiter group
  if (arbiter.length > 0) {
    lines.push("[mongodb_arbiter]");
    for (const { server, node } of arbiter) {
      const hostname = server.host.replace(/\./g, "_");
      lines.push(
        `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
      );
    }
    lines.push("");
  }

  // Parent group
  lines.push("[mongodb:children]");
  lines.push("mongodb_primary");
  if (secondary.length > 0) lines.push("mongodb_secondary");
  if (arbiter.length > 0) lines.push("mongodb_arbiter");
  lines.push("");

  // Common vars
  lines.push("[all:vars]");
  lines.push("ansible_python_interpreter=/usr/bin/python3");

  return lines.join("\n");
}

function buildRemoveInventory(
  servers: Array<{ server: any; node: TDatabaseNode }>,
  database: TDatabase
): string {
  const lines: string[] = ["[mongodb]"];

  for (const { server } of servers) {
    const hostname = server.host.replace(/\./g, "_");
    lines.push(
      `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort}`
    );
  }

  lines.push("");
  lines.push("[all:vars]");
  lines.push("ansible_python_interpreter=/usr/bin/python3");

  return lines.join("\n");
}

function buildExtraVars(database: TDatabase, isReplicaSet: boolean): Record<string, any> {
  const vars: Record<string, any> = {
    mongodb_version: database.version || "7.0",
    mongodb_admin_user: database.credentials.adminUser,
    mongodb_admin_password: database.credentials.adminPassword,
    mongodb_container_name: `mongodb_${database.name}`,
    mongodb_port: database.config.port || 27017,
    mongodb_data_dir: database.config.dataDir || "/opt/mongodb/data",
    mongodb_config_dir: database.config.configDir || "/opt/mongodb/config",
    mongodb_log_dir: database.config.logDir || "/opt/mongodb/logs",
  };

  if (isReplicaSet) {
    vars.mongodb_replicaset_name = database.config.replicaSetName || `rs_${database.name}`;
    vars.mongodb_keyfile_dir = database.config.keyfileDir || "/opt/mongodb/keyfile";
  }

  // Optional config
  if (database.config.cacheSizeGB) {
    vars.mongodb_cache_size_gb = database.config.cacheSizeGB;
  }

  if (database.config.allowedIps) {
    vars.mongodb_allowed_ips = database.config.allowedIps;
  }

  return vars;
}

function buildConnectionString(
  database: TDatabase,
  servers: Array<{ server: any; node: TDatabaseNode }>
): string {
  const hosts = servers.map((s) => `${s.server.host}:${database.config.port || 27017}`).join(",");
  const user = encodeURIComponent(database.credentials.adminUser);
  const password = encodeURIComponent(database.credentials.adminPassword);

  let connectionString = `mongodb://${user}:${password}@${hosts}/admin`;

  if (servers.length > 1) {
    const replicaSetName = database.config.replicaSetName || `rs_${database.name}`;
    connectionString += `?replicaSet=${replicaSetName}`;
  }

  return connectionString;
}

function maskPassword(connectionString: string): string {
  return connectionString.replace(/:[^:@]+@/, ":****@");
}
