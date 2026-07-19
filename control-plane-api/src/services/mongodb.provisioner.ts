import crypto from "crypto";
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

export type TAddNodeOptions = {
  databaseId: string;
  serverId: string;
  role: "secondary" | "arbiter";
  triggeredBy: string;
  onLog?: (line: string) => void;
};

export type TRemoveNodeOptions = {
  databaseId: string;
  serverId: string;
  triggeredBy: string;
  onLog?: (line: string) => void;
};

export type THealthCheckResult = {
  status: string;
  members: Array<{
    host: string;
    state: string;
    health: number;
  }>;
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

      // Generate keyfile content for replica set (generate it here so we can store it)
      let keyfileContent: string | undefined;
      if (isReplicaSet) {
        keyfileContent = generateKeyfileContent();
        extraVars.mongodb_keyfile_content = keyfileContent;
        log("Generated keyfile for replica set authentication");
      }

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

        // Update database with connection string, running status, and keyfile (for replica sets)
        const updateData: Partial<TDatabase> = {
          status: "running",
          credentials: {
            ...database.credentials,
            connectionString,
          },
        };

        // Store keyfile content in config for future node additions
        if (isReplicaSet && keyfileContent) {
          updateData.config = {
            ...database.config,
            keyfileContent,
          };
          log("Stored keyfile content in database config for future node additions");
        }

        await databaseRepo.updateById(databaseId, updateData);

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

  /**
   * Add a node to an existing MongoDB deployment
   * For standalone → replica set conversion: reconfigure existing node with keyfile auth, then add new node
   * For existing replica set: just add the new node
   */
  async function addNode(options: TAddNodeOptions): Promise<TProvisionResult> {
    const { databaseId, serverId, role, triggeredBy, onLog } = options;
    const logs: string[] = [];

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB AddNode] ${line}` });
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

      // Get the new server
      const newServer = await serverRepo.getById(serverId);
      if (!newServer) {
        throw new NotFoundError(`Server not found: ${serverId}`);
      }

      const isCurrentlyStandalone = database.nodes.length === 1 &&
        database.nodes[0].role === "standalone";

      log(`Adding node to MongoDB deployment: ${database.name}`);
      log(`New server: ${newServer.host}`);
      log(`Role: ${role}`);
      log(`Mode: ${isCurrentlyStandalone ? "standalone → replica set conversion" : "adding to existing replica set"}`);

      // Get existing server details
      const existingServers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) {
            throw new NotFoundError(`Server not found: ${node.serverId}`);
          }
          return { server, node };
        })
      );

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: new ObjectId(databaseId),
        image: `mongo:${database.version}`,
        triggeredBy: new ObjectId(triggeredBy),
      });

      await deploymentRepo.updateStatus(deploymentId, "running");

      // Retrieve stored keyfile content for existing replica sets
      // For standalone-to-replica conversion, we'll generate a new one
      let keyfileContent: string | undefined;
      if (!isCurrentlyStandalone && database.config.keyfileContent) {
        keyfileContent = database.config.keyfileContent;
        log("Retrieved stored keyfile content from database config");
      }

      let result;

      if (isCurrentlyStandalone) {
        // Convert standalone to replica set
        log("Converting standalone to replica set...");

        // Generate a new keyfile for the conversion
        keyfileContent = generateKeyfileContent();
        log("Generated keyfile for replica set authentication");

        // First, reconfigure the existing primary with keyfile auth
        const conversionInventory = buildConversionInventory(
          existingServers[0],
          { server: newServer, node: { serverId: new ObjectId(serverId), role, status: "syncing" } },
          database
        );

        const conversionInventoryPath = await ansible.writeInventoryFile(conversionInventory);

        const conversionVars = {
          ...buildConversionExtraVars(database),
          mongodb_keyfile_content: keyfileContent,
        };

        log("Running standalone-to-replicaset conversion playbook...");

        result = await ansible.execPlaybook(
          {
            playbook: "mongodb-convert-to-replicaset.yml",
            inventory: conversionInventoryPath,
            extraVars: conversionVars,
            verbose: true,
          },
          log
        );

        // If conversion playbook doesn't exist, fall back to full reprovision approach
        if (!result.success && result.stderr.includes("Playbook not found")) {
          log("Conversion playbook not found, using full reprovision approach...");

          // Update the existing node role to primary
          await databaseRepo.updateById(databaseId, {
            nodes: [{ ...database.nodes[0], role: "primary" }],
          });

          // Add the new node
          await databaseRepo.addNode(databaseId, {
            serverId: new ObjectId(serverId),
            role,
            status: "syncing",
          });

          // Re-provision as replica set
          result = await provision({
            databaseId,
            triggeredBy,
            onLog: log,
          });

          return result;
        }
      } else {
        // Add to existing replica set
        log("Adding node to existing replica set...");

        // Ensure we have the keyfile content
        if (!keyfileContent) {
          throw new BadRequestError(
            "Cannot add node to replica set: keyfile content not found in database config. " +
            "This replica set may have been provisioned before keyfile storage was implemented."
          );
        }

        const addNodeInventory = buildAddNodeInventory(
          existingServers,
          { server: newServer, node: { serverId: new ObjectId(serverId), role, status: "syncing" } },
          database
        );

        const addNodeInventoryPath = await ansible.writeInventoryFile(addNodeInventory);

        const addNodeVars = {
          ...buildExtraVars(database, true),
          mongodb_keyfile_content: keyfileContent,
          new_node_host: newServer.host,
          new_node_port: database.config.port || 27017,
          new_node_role: role,
        };

        result = await ansible.execPlaybook(
          {
            playbook: "mongodb-add-node.yml",
            inventory: addNodeInventoryPath,
            extraVars: addNodeVars,
            verbose: true,
          },
          log
        );
      }

      // Update deployment status
      await deploymentRepo.updateStatus(
        deploymentId,
        result.success ? "success" : "failed",
        result.stdout + "\n" + result.stderr
      );

      if (result.success) {
        // Add the node to the database record
        await databaseRepo.addNode(databaseId, {
          serverId: new ObjectId(serverId),
          role,
          status: "running",
        });

        // If this was a conversion, update the original node's role and store the keyfile
        if (isCurrentlyStandalone) {
          const originalNode = database.nodes[0];
          await databaseRepo.updateById(databaseId, {
            nodes: [
              { ...originalNode, role: "primary", status: "running" },
            ],
          });
          // Re-add the new node since updateById replaced the nodes array
          await databaseRepo.addNode(databaseId, {
            serverId: new ObjectId(serverId),
            role,
            status: "running",
          });

          // Update config with replica set name and keyfile content
          await databaseRepo.updateById(databaseId, {
            config: {
              ...database.config,
              replicaSetName: database.config.replicaSetName || `rs_${database.name}`,
              keyfileContent, // Store keyfile for future node additions
            },
          });
          log("Stored keyfile content in database config for future node additions");
        }

        // Rebuild connection string with all nodes
        const updatedDatabase = await databaseRepo.getById(databaseId);
        if (updatedDatabase) {
          const allServers = await Promise.all(
            updatedDatabase.nodes.map(async (node) => {
              const server = await serverRepo.getById(node.serverId);
              return { server: server!, node };
            })
          );
          const connectionString = buildConnectionString(updatedDatabase, allServers);
          await databaseRepo.updateById(databaseId, {
            credentials: {
              ...updatedDatabase.credentials,
              connectionString,
            },
          });
        }

        log("Node added successfully!");

        return {
          success: true,
          logs,
        };
      } else {
        log("Failed to add node!");
        log(result.stderr);

        return {
          success: false,
          error: result.stderr || "Failed to add node",
          logs,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs,
      };
    }
  }

  /**
   * Remove a node from a MongoDB replica set
   */
  async function removeNodeFromCluster(options: TRemoveNodeOptions): Promise<TProvisionResult> {
    const { databaseId, serverId, triggeredBy, onLog } = options;
    const logs: string[] = [];

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB RemoveNode] ${line}` });
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

      // Find the node to remove
      const nodeToRemove = database.nodes.find(
        (n) => n.serverId.toString() === serverId.toString()
      );

      if (!nodeToRemove) {
        throw new NotFoundError("Node not found in database");
      }

      // Get the server being removed
      const removingServer = await serverRepo.getById(serverId);
      if (!removingServer) {
        throw new NotFoundError(`Server not found: ${serverId}`);
      }

      // Find the primary node to execute commands
      const primaryNode = database.nodes.find((n) => n.role === "primary");
      if (!primaryNode) {
        throw new BadRequestError("No primary node found");
      }

      const primaryServer = await serverRepo.getById(primaryNode.serverId);
      if (!primaryServer) {
        throw new NotFoundError(`Primary server not found: ${primaryNode.serverId}`);
      }

      log(`Removing node from MongoDB deployment: ${database.name}`);
      log(`Removing server: ${removingServer.host}`);

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: new ObjectId(databaseId),
        image: `mongo:${database.version}`,
        triggeredBy: new ObjectId(triggeredBy),
      });

      await deploymentRepo.updateStatus(deploymentId, "running");

      // Build inventory with primary
      const inventoryContent = buildRemoveNodeInventory(
        { server: primaryServer, node: primaryNode },
        { server: removingServer, node: nodeToRemove },
        database
      );

      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      const removeNodeVars = {
        ...buildExtraVars(database, true),
        remove_node_host: removingServer.host,
        remove_node_port: database.config.port || 27017,
      };

      log("Running remove-node playbook...");

      const result = await ansible.execPlaybook(
        {
          playbook: "mongodb-remove-node.yml",
          inventory: inventoryPath,
          extraVars: removeNodeVars,
          verbose: true,
        },
        log
      );

      // Update deployment status
      await deploymentRepo.updateStatus(
        deploymentId,
        result.success ? "success" : "failed",
        result.stdout + "\n" + result.stderr
      );

      if (result.success) {
        // Remove the node from the database record
        await databaseRepo.removeNode(databaseId, serverId);

        // Rebuild connection string with remaining nodes
        const updatedDatabase = await databaseRepo.getById(databaseId);
        if (updatedDatabase && updatedDatabase.nodes.length > 0) {
          const remainingServers = await Promise.all(
            updatedDatabase.nodes.map(async (node) => {
              const server = await serverRepo.getById(node.serverId);
              return { server: server!, node };
            })
          );
          const connectionString = buildConnectionString(updatedDatabase, remainingServers);
          await databaseRepo.updateById(databaseId, {
            credentials: {
              ...updatedDatabase.credentials,
              connectionString,
            },
          });
        }

        log("Node removed successfully!");

        return {
          success: true,
          logs,
        };
      } else {
        log("Failed to remove node!");
        log(result.stderr);

        return {
          success: false,
          error: result.stderr || "Failed to remove node",
          logs,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return {
        success: false,
        error: error.message,
        logs,
      };
    }
  }

  /**
   * Get health status of a MongoDB deployment
   * SSHs into primary/standalone node and runs rs.status() or db.adminCommand('ping')
   */
  async function getHealth(databaseId: string): Promise<THealthCheckResult> {
    const database = await databaseRepo.getById(databaseId);
    if (!database) {
      throw new NotFoundError("Database not found");
    }

    if (database.type !== "mongodb") {
      throw new BadRequestError("This health check only supports MongoDB");
    }

    // Find the primary or standalone node
    const targetNode = database.nodes.find(
      (n) => n.role === "primary" || n.role === "standalone"
    );

    if (!targetNode) {
      throw new BadRequestError("No primary or standalone node found");
    }

    const server = await serverRepo.getById(targetNode.serverId);
    if (!server) {
      throw new NotFoundError(`Server not found: ${targetNode.serverId}`);
    }

    const isReplicaSet = database.nodes.length > 1 ||
      database.nodes.some((n) => n.role !== "standalone");

    const containerName = `mongodb_${database.name}`;
    const adminUser = database.credentials.adminUser;
    const adminPassword = database.credentials.adminPassword;

    // Build the mongosh command
    let mongoCommand: string;
    if (isReplicaSet) {
      // For replica set, get rs.status()
      mongoCommand = `rs.status()`;
    } else {
      // For standalone, just ping
      mongoCommand = `db.adminCommand('ping')`;
    }

    // Execute via SSH to the server
    const { spawn } = await import("child_process");

    return new Promise((resolve, reject) => {
      const sshCommand = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-p", String(server.sshPort || 22),
        `${server.sshUser}@${server.host}`,
        `docker exec ${containerName} mongosh -u "${adminUser}" -p "${adminPassword}" --authenticationDatabase admin --quiet --eval "JSON.stringify(${mongoCommand})"`
      ];

      let stdout = "";
      let stderr = "";

      const proc = spawn("ssh", sshCommand);

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code !== 0) {
          logger.log({
            level: "error",
            message: `Health check failed: ${stderr}`,
          });

          // Return unhealthy status
          resolve({
            status: "unhealthy",
            members: database.nodes.map((node) => ({
              host: node.serverId.toString(),
              state: "unknown",
              health: 0,
            })),
          });
          return;
        }

        try {
          // Find the JSON in the output (mongosh might output extra lines)
          const jsonMatch = stdout.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error("No JSON found in output");
          }

          const result = JSON.parse(jsonMatch[0]);

          if (isReplicaSet && result.members) {
            // Parse rs.status() output
            const members = result.members.map((m: any) => ({
              host: m.name || m.host,
              state: getStateString(m.state),
              health: m.health || 0,
            }));

            resolve({
              status: result.ok === 1 ? "healthy" : "unhealthy",
              members,
            });
          } else if (result.ok === 1) {
            // Standalone ping response
            resolve({
              status: "healthy",
              members: [{
                host: `${server.host}:${database.config.port || 27017}`,
                state: "standalone",
                health: 1,
              }],
            });
          } else {
            resolve({
              status: "unhealthy",
              members: [{
                host: `${server.host}:${database.config.port || 27017}`,
                state: "unknown",
                health: 0,
              }],
            });
          }
        } catch (parseError: any) {
          logger.log({
            level: "error",
            message: `Failed to parse health check output: ${parseError.message}`,
          });

          resolve({
            status: "unknown",
            members: database.nodes.map((node) => ({
              host: node.serverId.toString(),
              state: "unknown",
              health: 0,
            })),
          });
        }
      });

      proc.on("error", (err) => {
        logger.log({
          level: "error",
          message: `Health check SSH error: ${err.message}`,
        });

        resolve({
          status: "error",
          members: [{
            host: server.host,
            state: "unreachable",
            health: 0,
          }],
        });
      });
    });
  }

  return {
    provision,
    remove,
    addNode,
    removeNode: removeNodeFromCluster,
    getHealth,
  };
}

/**
 * Convert MongoDB replica set state number to string
 */
function getStateString(state: number): string {
  const states: Record<number, string> = {
    0: "STARTUP",
    1: "PRIMARY",
    2: "SECONDARY",
    3: "RECOVERING",
    5: "STARTUP2",
    6: "UNKNOWN",
    7: "ARBITER",
    8: "DOWN",
    9: "ROLLBACK",
    10: "REMOVED",
  };
  return states[state] || "UNKNOWN";
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

function buildConversionInventory(
  primary: { server: any; node: TDatabaseNode },
  secondary: { server: any; node: TDatabaseNode },
  database: TDatabase
): string {
  const lines: string[] = [];

  // Primary (current standalone being converted)
  const primaryHostname = primary.server.host.replace(/\./g, "_");
  lines.push("[mongodb_primary]");
  lines.push(
    `${primaryHostname} ansible_host=${primary.server.host} ansible_user=${primary.server.sshUser} ansible_port=${primary.server.sshPort} mongodb_node_role=primary`
  );
  lines.push("");

  // New node being added
  const secondaryHostname = secondary.server.host.replace(/\./g, "_");
  if (secondary.node.role === "secondary") {
    lines.push("[mongodb_secondary]");
  } else {
    lines.push("[mongodb_arbiter]");
  }
  lines.push(
    `${secondaryHostname} ansible_host=${secondary.server.host} ansible_user=${secondary.server.sshUser} ansible_port=${secondary.server.sshPort} mongodb_node_role=${secondary.node.role}`
  );
  lines.push("");

  // Parent group
  lines.push("[mongodb:children]");
  lines.push("mongodb_primary");
  if (secondary.node.role === "secondary") {
    lines.push("mongodb_secondary");
  } else {
    lines.push("mongodb_arbiter");
  }
  lines.push("");

  // Common vars
  lines.push("[all:vars]");
  lines.push("ansible_python_interpreter=/usr/bin/python3");

  return lines.join("\n");
}

function buildConversionExtraVars(database: TDatabase): Record<string, any> {
  return {
    mongodb_version: database.version || "7.0",
    mongodb_admin_user: database.credentials.adminUser,
    mongodb_admin_password: database.credentials.adminPassword,
    mongodb_container_name: `mongodb_${database.name}`,
    mongodb_port: database.config.port || 27017,
    mongodb_data_dir: database.config.dataDir || "/opt/mongodb/data",
    mongodb_config_dir: database.config.configDir || "/opt/mongodb/config",
    mongodb_log_dir: database.config.logDir || "/opt/mongodb/logs",
    mongodb_replicaset_name: database.config.replicaSetName || `rs_${database.name}`,
    mongodb_keyfile_dir: database.config.keyfileDir || "/opt/mongodb/keyfile",
  };
}

function buildAddNodeInventory(
  existingServers: Array<{ server: any; node: TDatabaseNode }>,
  newNode: { server: any; node: TDatabaseNode },
  database: TDatabase
): string {
  const lines: string[] = [];

  // Group existing servers by role
  const primary = existingServers.filter((s) => s.node.role === "primary");
  const secondary = existingServers.filter((s) => s.node.role === "secondary");
  const arbiter = existingServers.filter((s) => s.node.role === "arbiter");

  // Primary group
  lines.push("[mongodb_primary]");
  for (const { server, node } of primary) {
    const hostname = server.host.replace(/\./g, "_");
    lines.push(
      `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
    );
  }
  lines.push("");

  // Secondary group (include new node if it's a secondary)
  const allSecondaries = newNode.node.role === "secondary"
    ? [...secondary, newNode]
    : secondary;

  if (allSecondaries.length > 0) {
    lines.push("[mongodb_secondary]");
    for (const { server, node } of allSecondaries) {
      const hostname = server.host.replace(/\./g, "_");
      lines.push(
        `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
      );
    }
    lines.push("");
  }

  // Arbiter group (include new node if it's an arbiter)
  const allArbiters = newNode.node.role === "arbiter"
    ? [...arbiter, newNode]
    : arbiter;

  if (allArbiters.length > 0) {
    lines.push("[mongodb_arbiter]");
    for (const { server, node } of allArbiters) {
      const hostname = server.host.replace(/\./g, "_");
      lines.push(
        `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`
      );
    }
    lines.push("");
  }

  // New node group (for targeting in playbook)
  const newHostname = newNode.server.host.replace(/\./g, "_");
  lines.push("[mongodb_new]");
  lines.push(
    `${newHostname} ansible_host=${newNode.server.host} ansible_user=${newNode.server.sshUser} ansible_port=${newNode.server.sshPort} mongodb_node_role=${newNode.node.role}`
  );
  lines.push("");

  // Parent group
  lines.push("[mongodb:children]");
  lines.push("mongodb_primary");
  if (allSecondaries.length > 0) lines.push("mongodb_secondary");
  if (allArbiters.length > 0) lines.push("mongodb_arbiter");
  lines.push("mongodb_new");
  lines.push("");

  // Common vars
  lines.push("[all:vars]");
  lines.push("ansible_python_interpreter=/usr/bin/python3");

  return lines.join("\n");
}

function buildRemoveNodeInventory(
  primary: { server: any; node: TDatabaseNode },
  nodeToRemove: { server: any; node: TDatabaseNode },
  database: TDatabase
): string {
  const lines: string[] = [];

  // Primary (for executing rs.remove())
  const primaryHostname = primary.server.host.replace(/\./g, "_");
  lines.push("[mongodb_primary]");
  lines.push(
    `${primaryHostname} ansible_host=${primary.server.host} ansible_user=${primary.server.sshUser} ansible_port=${primary.server.sshPort} mongodb_node_role=primary`
  );
  lines.push("");

  // Node to remove (for stopping container)
  const removeHostname = nodeToRemove.server.host.replace(/\./g, "_");
  lines.push("[mongodb_remove]");
  lines.push(
    `${removeHostname} ansible_host=${nodeToRemove.server.host} ansible_user=${nodeToRemove.server.sshUser} ansible_port=${nodeToRemove.server.sshPort} mongodb_node_role=${nodeToRemove.node.role}`
  );
  lines.push("");

  // Parent group
  lines.push("[mongodb:children]");
  lines.push("mongodb_primary");
  lines.push("mongodb_remove");
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

/**
 * Generate a MongoDB keyfile content for replica set authentication.
 * Uses 756 random bytes encoded in base64, matching MongoDB's requirement.
 */
function generateKeyfileContent(): string {
  return crypto.randomBytes(756).toString("base64");
}
