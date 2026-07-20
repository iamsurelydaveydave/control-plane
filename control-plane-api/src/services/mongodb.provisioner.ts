import crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { ObjectId } from "mongodb";
import { useAnsibleExecutor } from "./ansible.executor";
import { useServerRepo } from "../resources/server";
import { useDatabaseRepo, TDatabase, TDatabaseNode } from "../resources/database";
import { useDeploymentRepo } from "../resources/deployment";
import { useSSHKeyService } from "../resources/ssh-key";
import { useSettingsRepo } from "../resources/settings";
import { useDNSService, TDNSReplicaSetResult } from "./dns.service";
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

export type TBackupOptions = {
  databaseId: string;
  triggeredBy: string;
  onLog?: (line: string) => void;
};

export type TRestoreOptions = {
  databaseId: string;
  s3Key: string;
  triggeredBy: string;
  onLog?: (line: string) => void;
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
  const sshKeyService = useSSHKeyService();

  /**
   * Resolve the SSH private key for a set of servers and write it to a temp
   * file. Checks `server.sshKeyId` on the first server, then falls back to
   * the installation-wide default key. Returns the temp-file path, or null if
   * no key is registered (Ansible will rely on the system SSH agent).
   */
  async function resolveSSHKeyFile(
    servers: Array<{ server: any }>
  ): Promise<string | null> {
    for (const { server } of servers) {
      if (server.sshKeyId) {
        const key = await sshKeyService.getFullById(String(server.sshKeyId));
        if (key?.privateKey) return writeKeyFile(key.privateKey);
      }
    }
    const defaultKey = await sshKeyService.getDefaultFull();
    if (defaultKey?.privateKey) return writeKeyFile(defaultKey.privateKey);
    return null;
  }
  async function provision(options: TMongoDBProvisionOptions): Promise<TProvisionResult> {
    const { databaseId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    let sshKeyFile: string | null = null;
    // Tracked so the catch block can always persist failure logs to MongoDB.
    let deploymentId: ObjectId | null = null;

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB Provision] ${line}` });
    };

    try {
      // ----------------------------------------------------------------
      // 1. Fetch database — needed before we can create a deployment record.
      // ----------------------------------------------------------------
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

      // ----------------------------------------------------------------
      // 2. Create the deployment record IMMEDIATELY so every failure path
      //    (Ansible missing, SSH error, server offline, …) always writes
      //    a record with the full error log.
      // ----------------------------------------------------------------
      await databaseRepo.updateStatus(databaseId, "provisioning");

      deploymentId = await deploymentRepo.add({
        appId: databaseId,
        image: `mongo:${database.version}`,
        triggeredBy: triggeredBy || new ObjectId().toHexString(),
      });
      await deploymentRepo.updateStatus(deploymentId, "running");

      // ----------------------------------------------------------------
      // 3. Pre-flight checks (these now log failures to the deployment record
      //    via the catch block below).
      // ----------------------------------------------------------------
      const ansibleInstalled = await ansible.checkAnsibleInstalled();
      if (!ansibleInstalled) {
        throw new InternalServerError("Ansible is not installed on this server");
      }

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

      // Resolve SSH key for Ansible
      sshKeyFile = await resolveSSHKeyFile(servers);
      if (sshKeyFile) {
        log("SSH key resolved for Ansible");
      } else {
        log("No SSH key registered — Ansible will use system SSH agent");
      }

      // ----------------------------------------------------------------
      // 4. Run the playbook.
      // ----------------------------------------------------------------
      const isReplicaSet = database.nodes.length > 1;
      const playbook = isReplicaSet ? "mongodb-replicaset.yml" : "mongodb-standalone.yml";

      let inventoryContent: string;
      if (isReplicaSet) {
        inventoryContent = buildReplicaSetInventory(servers, database, sshKeyFile ?? undefined);
      } else {
        inventoryContent = buildStandaloneInventory(servers[0], database, sshKeyFile ?? undefined);
      }

      log("Generated inventory:");
      log(inventoryContent);

      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);
      const extraVars = buildExtraVars(database, isReplicaSet);

      let keyfileContent: string | undefined;
      if (isReplicaSet) {
        keyfileContent = generateKeyfileContent();
        extraVars.mongodb_keyfile_content = keyfileContent;
        log("Generated keyfile for replica set authentication");
      }

      log("Starting Ansible playbook execution...");

      const result = await ansible.execPlaybook(
        { playbook, inventory: inventoryPath, extraVars, verbose: true },
        log
      );

      // ----------------------------------------------------------------
      // 5. Persist full logs to the deployment record.
      // ----------------------------------------------------------------
      await deploymentRepo.updateStatus(
        deploymentId,
        result.success ? "success" : "failed",
        logs.join("\n")
      );

      if (result.success) {
        const connectionString = buildConnectionString(database, servers);

        const updateData: Partial<TDatabase> = {
          status: "running",
          credentials: { ...database.credentials, connectionString },
        };

        if (isReplicaSet && keyfileContent) {
          updateData.config = { ...database.config, keyfileContent };
          log("Stored keyfile content in database config for future node additions");
        }

        await databaseRepo.updateById(databaseId, updateData);

        for (const { node } of servers) { node.status = "running"; }
        await databaseRepo.updateById(databaseId, { nodes: database.nodes });

        log("MongoDB provisioning completed successfully!");
        log(`Connection string: ${maskPassword(connectionString)}`);

        // ----------------------------------------------------------------
        // 6. Post-provisioning setup: DNS and TLS (replica sets only)
        //    DNS and admin-user-replication-wait run concurrently since
        //    they are independent. TLS runs after the wait completes.
        // ----------------------------------------------------------------
        let tlsConnectionString = connectionString;
        if (isReplicaSet) {
          // Start DNS setup and replication wait concurrently
          const dnsPromise = (async (): Promise<string[]> => {
            try {
              const dns = useDNSService();
              const replicaSetName = database.config.replicaSetName || `rs_${database.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
              const dnsResult = await dns.setupReplicaSet({
                databaseName: database.name,
                nodes: servers.map((s) => ({ host: s.server.host, port: database.config.port || 27017 })),
                adminUser: database.credentials.adminUser,
                adminPassword: database.credentials.adminPassword,
                replicaSetName,
              });

              if (dnsResult) {
                await databaseRepo.updateDNS(databaseId, {
                  enabled: true,
                  provider: "cloudflare",
                  clusterHost: dnsResult.clusterHost,
                  nodeHosts: dnsResult.nodeHosts,
                  srvConnectionString: dnsResult.srvConnectionString,
                  records: dnsResult.records,
                  configuredAt: new Date(),
                });
                log(`DNS configured: ${dnsResult.clusterHost}`);
                log(`SRV connection string: ${maskPassword(dnsResult.srvConnectionString)}`);
                return dnsResult.nodeHosts;
              }
            } catch (dnsErr: any) {
              log(`[DNS] Setup skipped or failed (non-fatal): ${dnsErr.message}`);
            }
            return [];
          })();

          const replicationWaitPromise = (async () => {
            log("");
            log("Waiting 10s for admin user replication before TLS configuration...");
            await new Promise((r) => setTimeout(r, 10_000));
          })();

          // Wait for both DNS and replication wait to complete concurrently
          const [dnsHostnames] = await Promise.all([dnsPromise, replicationWaitPromise]);

          // Now configure TLS (depends on replication wait completing)
          log("");
          log("=".repeat(60));
          log("Starting TLS configuration...");
          log("=".repeat(60));

          try {
            const tlsResult = await configureTLSInternal({
              databaseId,
              servers,
              database,
              dnsHostnames,
              sshKeyFile,
              onLog: log,
            });

            if (tlsResult.success) {
              tlsConnectionString = tlsResult.tlsConnectionString || connectionString;
              log("TLS configuration completed successfully!");
              log(`TLS connection string: ${maskPassword(tlsConnectionString)}`);
            } else {
              log(`[TLS] Configuration failed (non-fatal): ${tlsResult.error}`);
              log("Database is running without TLS. You can configure TLS later via POST /databases/:id/tls");
            }
          } catch (tlsErr: any) {
            log(`[TLS] Configuration failed (non-fatal): ${tlsErr.message}`);
            log("Database is running without TLS. You can configure TLS later via POST /databases/:id/tls");
          }
        }

        return { success: true, connectionString: tlsConnectionString, logs };
      } else {
        await databaseRepo.updateStatus(databaseId, "failed");
        log("MongoDB provisioning failed!");
        log(result.stderr);
        return { success: false, error: result.stderr || "Ansible playbook failed", logs };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);

      // Always persist logs to the deployment record, even for early failures.
      if (deploymentId) {
        await deploymentRepo.updateStatus(deploymentId, "failed", logs.join("\n")).catch(() => {});
      }

      await databaseRepo.updateStatus(databaseId, "failed").catch(() => {});

      return { success: false, error: error.message, logs };
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  /**
   * Remove a MongoDB deployment - reverses everything created by provisioning
   * @param databaseId - The database ID
   * @param keepData - If true, keeps the data directory (default: false = delete everything)
   * @param onLog - Callback for log messages
   */
  async function remove(
    databaseId: string,
    keepData: boolean = false,
    onLog?: (line: string) => void
  ): Promise<TProvisionResult> {
    const logs: string[] = [];
    let sshKeyFile: string | null = null;

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
      log(`Keep data: ${keepData}`);

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

      sshKeyFile = await resolveSSHKeyFile(servers);

      // Build inventory
      const inventoryContent = buildRemoveInventory(servers, database, sshKeyFile ?? undefined);
      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const baseDir = `/opt/mongodb/${safeName}`;

      log(`Removing containers on ${servers.length} node(s)...`);

      // Execute remove playbook
      const result = await ansible.execPlaybook(
        {
          playbook: "mongodb-remove.yml",
          inventory: inventoryPath,
          extraVars: {
            mongodb_container_name: `mongodb_${safeName}`,
            mongodb_base_dir: baseDir,
            mongodb_data_dir: database.config?.dataDir || `${baseDir}/data`,
            mongodb_config_dir: database.config?.configDir || `${baseDir}/config`,
            mongodb_log_dir: database.config?.logDir || `${baseDir}/logs`,
            mongodb_keyfile_dir: database.config?.keyfileDir || `${baseDir}/keyfile`,
            mongodb_tls_dir: database.config?.tlsDir || `${baseDir}/tls`,
            mongodb_port: database.config?.port || 27017,
            keep_data: keepData,
          },
          verbose: true,
        },
        log
      );

      if (result.success) {
        log("MongoDB containers and files removed successfully!");

        // Tear down DNS records if any were configured
        try {
          const freshDb = await databaseRepo.getById(databaseId);
          if (freshDb?.dns?.records?.length) {
            log(`Removing ${freshDb.dns.records.length} DNS records...`);
            const dns = useDNSService();
            await dns.teardown(freshDb.dns.records);
            await databaseRepo.updateDNS(databaseId, null);
            log("DNS records removed");
          }
        } catch (dnsErr: any) {
          log(`[DNS] Teardown failed (non-fatal): ${dnsErr.message}`);
        }

        // Clear TLS config
        if (database.tls?.enabled) {
          await databaseRepo.updateTLS(databaseId, null);
          log("TLS configuration cleared");
        }

        // Update database status and clear sensitive config
        await databaseRepo.updateStatus(databaseId, "stopped");
        
        // Update node statuses and clear connection string (no longer valid)
        for (const { node } of servers) {
          node.status = "stopped";
        }
        await databaseRepo.updateById(databaseId, {
          nodes: database.nodes,
          credentials: {
            ...database.credentials,
            connectionString: "",  // No longer valid
          },
          config: {
            ...database.config,
            keyfileContent: undefined,  // Security: clear keyfile from DB
          },
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
    } finally {
      cleanupKeyFile(sshKeyFile);
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
    let sshKeyFile: string | null = null;

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

      // Resolve SSH key for Ansible
      sshKeyFile = await resolveSSHKeyFile([
        ...existingServers,
        { server: newServer, node: { serverId: new ObjectId(serverId), role, status: "syncing" } as TDatabaseNode },
      ]);

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: databaseId,
        image: `mongo:${database.version}`,
        triggeredBy: triggeredBy || new ObjectId().toHexString(),
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
          database,
          sshKeyFile ?? undefined
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
          database,
          sshKeyFile ?? undefined
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
        logs.join("\n")
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
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  /**
   * Remove a node from a MongoDB replica set
   */
  async function removeNodeFromCluster(options: TRemoveNodeOptions): Promise<TProvisionResult> {
    const { databaseId, serverId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    let sshKeyFile: string | null = null;

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

      // Resolve SSH key for Ansible
      sshKeyFile = await resolveSSHKeyFile([
        { server: primaryServer },
        { server: removingServer },
      ]);

      // Create deployment record
      const deploymentId = await deploymentRepo.add({
        appId: databaseId,
        image: `mongo:${database.version}`,
        triggeredBy: triggeredBy || new ObjectId().toHexString(),
      });

      await deploymentRepo.updateStatus(deploymentId, "running");

      // Build inventory with primary
      const inventoryContent = buildRemoveNodeInventory(
        { server: primaryServer, node: primaryNode },
        { server: removingServer, node: nodeToRemove },
        database,
        sshKeyFile ?? undefined
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
        logs.join("\n")
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
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  /**
   * Get health status of a MongoDB deployment.
   * SSHs into the primary/standalone node and runs rs.status() or db.adminCommand('ping').
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

    // Resolve SSH key for this server
    const sshKeyFile = await resolveSSHKeyFile([{ server }]);

    const cleanup = () => cleanupKeyFile(sshKeyFile);

    return new Promise((resolve) => {
      const sshArgs = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-p", String(server.sshPort || 22),
      ];
      if (sshKeyFile) {
        sshArgs.push("-i", sshKeyFile);
      }
      sshArgs.push(
        `${server.sshUser}@${server.host}`,
        `docker exec ${containerName} mongosh -u "${adminUser}" -p "${adminPassword}" --authenticationDatabase admin --quiet --eval "JSON.stringify(${mongoCommand})"`
      );

      let stdout = "";
      let stderr = "";

      const proc = spawn("ssh", sshArgs);

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
          cleanup();
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
        } finally {
          cleanup();
        }
      });

      proc.on("error", (err) => {
        logger.log({
          level: "error",
          message: `Health check SSH error: ${err.message}`,
        });
        cleanup();
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

  /**
   * Backup a MongoDB deployment to S3
   */
  async function backup(options: TBackupOptions): Promise<TProvisionResult & { s3Key?: string }> {
    const { databaseId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    let sshKeyFile: string | null = null;

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB Backup] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) throw new NotFoundError("Database not found");

      log(`Starting backup for: ${database.name}`);

      // Fetch S3 credentials from settings
      const settingsRepo = useSettingsRepo();
      const [s3AccessKeyId, s3SecretAccessKey, s3Region, s3DefaultBucket] = await Promise.all([
        settingsRepo.get("s3.accessKeyId"),
        settingsRepo.get("s3.secretAccessKey"),
        settingsRepo.get("s3.region"),
        settingsRepo.get("s3.defaultBucket"),
      ]);

      if (!s3AccessKeyId || !s3SecretAccessKey || !s3Region) {
        throw new BadRequestError("S3 credentials not configured");
      }

      const bucket = database.backup?.s3Bucket || s3DefaultBucket;
      if (!bucket) {
        throw new BadRequestError("S3 bucket not configured");
      }

      // Resolve servers
      const servers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) throw new NotFoundError(`Server not found: ${node.serverId}`);
          return { server, node };
        })
      );

      sshKeyFile = await resolveSSHKeyFile(servers);

      // Find primary (or standalone) node — backup always runs on primary
      const primaryServerData = servers.find(
        (s) => s.node.role === "primary" || s.node.role === "standalone"
      );
      if (!primaryServerData) {
        throw new BadRequestError("No primary node found for backup");
      }

      const inventoryContent = buildBackupInventory(primaryServerData, sshKeyFile ?? undefined);
      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const backupName = `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`;

      const extraVars = {
        mongodb_container_name: `mongodb_${safeName}`,
        mongodb_admin_user: database.credentials.adminUser,
        mongodb_admin_password: database.credentials.adminPassword,
        mongodb_port: database.config.port || 27017,
        s3_bucket: bucket,
        s3_access_key: s3AccessKeyId,
        s3_secret_key: s3SecretAccessKey,
        s3_region: s3Region,
        backup_name: backupName,
      };

      log("Starting Ansible backup playbook...");

      const result = await ansible.execPlaybook(
        {
          playbook: "mongodb-backup.yml",
          inventory: inventoryPath,
          extraVars,
          verbose: true,
        },
        log
      );

      if (result.success) {
        const s3Key = `mongodb_${safeName}/${backupName}.tar.gz`;

        await databaseRepo.addBackupRecord(databaseId, {
          s3Key,
          s3Bucket: bucket,
          s3Region,
          createdAt: new Date(),
          status: "success",
        });

        log(`Backup completed! S3 key: ${s3Key}`);
        return { success: true, s3Key, logs };
      } else {
        await databaseRepo.addBackupRecord(databaseId, {
          s3Key: "",
          s3Bucket: bucket,
          s3Region,
          createdAt: new Date(),
          status: "failed",
          error: result.stderr || "Ansible playbook failed",
        });

        return {
          success: false,
          error: result.stderr || "Backup playbook failed",
          logs,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  /**
   * Restore a MongoDB deployment from an S3 backup
   */
  async function restore(options: TRestoreOptions): Promise<TProvisionResult> {
    const { databaseId, s3Key, triggeredBy, onLog } = options;
    const logs: string[] = [];
    let sshKeyFile: string | null = null;

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB Restore] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) throw new NotFoundError("Database not found");

      log(`Starting restore for: ${database.name} from ${s3Key}`);

      // Fetch S3 credentials from settings
      const settingsRepo = useSettingsRepo();
      const [s3AccessKeyId, s3SecretAccessKey, s3Region, s3DefaultBucket] = await Promise.all([
        settingsRepo.get("s3.accessKeyId"),
        settingsRepo.get("s3.secretAccessKey"),
        settingsRepo.get("s3.region"),
        settingsRepo.get("s3.defaultBucket"),
      ]);

      if (!s3AccessKeyId || !s3SecretAccessKey || !s3Region) {
        throw new BadRequestError("S3 credentials not configured");
      }

      const bucket = database.backup?.s3Bucket || s3DefaultBucket;
      if (!bucket) {
        throw new BadRequestError("S3 bucket not configured");
      }

      // Resolve servers
      const servers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) throw new NotFoundError(`Server not found: ${node.serverId}`);
          return { server, node };
        })
      );

      sshKeyFile = await resolveSSHKeyFile(servers);

      // Restore always runs on the primary node
      const primaryServerData = servers.find(
        (s) => s.node.role === "primary" || s.node.role === "standalone"
      );
      if (!primaryServerData) {
        throw new BadRequestError("No primary node found for restore");
      }

      const inventoryContent = buildBackupInventory(primaryServerData, sshKeyFile ?? undefined);
      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);

      const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");

      const extraVars = {
        mongodb_container_name: `mongodb_${safeName}`,
        mongodb_admin_user: database.credentials.adminUser,
        mongodb_admin_password: database.credentials.adminPassword,
        mongodb_port: database.config.port || 27017,
        s3_bucket: bucket,
        s3_access_key: s3AccessKeyId,
        s3_secret_key: s3SecretAccessKey,
        s3_region: s3Region,
        s3_key: s3Key,
      };

      log("Starting Ansible restore playbook...");

      const result = await ansible.execPlaybook(
        {
          playbook: "mongodb-restore.yml",
          inventory: inventoryPath,
          extraVars,
          verbose: true,
        },
        log
      );

      if (result.success) {
        log("Restore completed successfully!");
        return { success: true, logs };
      } else {
        return {
          success: false,
          error: result.stderr || "Restore playbook failed",
          logs,
        };
      }
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  /**
   * Configure (or re-configure) DNS records for an existing running database.
   * Useful when DNS was not set up at provision time (e.g. Cloudflare was
   * configured later) or when re-pointing DNS after an IP change.
   *
   * Tears down old records first if any exist, then creates fresh ones.
   */
  async function configureDNS(databaseId: string): Promise<TDNSReplicaSetResult | null> {
    const database = await databaseRepo.getById(databaseId);
    if (!database) throw new NotFoundError("Database not found");
    if (database.type !== "mongodb") throw new BadRequestError("DNS only supported for MongoDB");
    if (database.status !== "running") throw new BadRequestError("Database must be running to configure DNS");
    if (database.nodes.length < 2) throw new BadRequestError("DNS SRV requires a replica set (2+ nodes)");

    // Tear down existing DNS records first
    if (database.dns?.records?.length) {
      try {
        const dns = useDNSService();
        await dns.teardown(database.dns.records);
        await databaseRepo.updateDNS(databaseId, null);
      } catch (err: any) {
        logger.log({ level: "warn", message: `[DNS] Pre-configure teardown: ${err.message}` });
      }
    }

    // Resolve servers
    const servers = await Promise.all(
      database.nodes.map(async (node) => {
        const server = await serverRepo.getById(node.serverId);
        if (!server) throw new NotFoundError(`Server not found: ${node.serverId}`);
        return { server, node };
      })
    );

    const replicaSetName =
      database.config.replicaSetName ||
      `rs_${database.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

    const dns = useDNSService();
    const result = await dns.setupReplicaSet({
      databaseName: database.name,
      nodes: servers.map((s) => ({
        host: s.server.host,
        port: database.config.port || 27017,
      })),
      adminUser: database.credentials.adminUser,
      adminPassword: database.credentials.adminPassword,
      replicaSetName,
    });

    if (result) {
      await databaseRepo.updateDNS(databaseId, {
        enabled: true,
        provider: "cloudflare",
        clusterHost: result.clusterHost,
        nodeHosts: result.nodeHosts,
        srvConnectionString: result.srvConnectionString,
        records: result.records,
        configuredAt: new Date(),
      });
    }

    return result;
  }

  /**
   * Internal TLS configuration - called during provisioning with pre-loaded data.
   * Does NOT clean up the SSH key file (caller is responsible).
   */
  async function configureTLSInternal(options: {
    databaseId: string;
    servers: Array<{ server: any; node: TDatabaseNode }>;
    database: TDatabase;
    dnsHostnames: string[];
    sshKeyFile: string | null;
    onLog?: (line: string) => void;
  }): Promise<{ success: boolean; error?: string; caCert?: string; tlsConnectionString?: string }> {
    const { databaseId, servers, database, dnsHostnames, sshKeyFile, onLog } = options;

    const log = (line: string) => {
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB TLS] ${line}` });
    };

    try {
      log(`Configuring TLS for: ${database.name}`);
      log(`Servers: ${servers.map((s) => s.server.host).join(", ")}`);

      // Build inventory for TLS playbook
      const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");
      const inventoryContent = buildReplicaSetInventory(servers, database, sshKeyFile ?? undefined);

      log("Generated TLS inventory");

      const inventoryPath = await ansible.writeInventoryFile(inventoryContent);
      const tlsDir = `/opt/mongodb/${safeName}/tls`;

      const extraVars: Record<string, any> = {
        mongodb_version: database.version || "8.0",
        mongodb_admin_user: database.credentials.adminUser,
        mongodb_admin_password: database.credentials.adminPassword,
        mongodb_container_name: `mongodb_${safeName}`,
        mongodb_port: database.config.port || 27017,
        mongodb_data_dir: database.config.dataDir || `/opt/mongodb/${safeName}/data`,
        mongodb_config_dir: database.config.configDir || `/opt/mongodb/${safeName}/config`,
        mongodb_log_dir: database.config.logDir || `/opt/mongodb/${safeName}/logs`,
        mongodb_keyfile_dir: database.config.keyfileDir || `/opt/mongodb/${safeName}/keyfile`,
        mongodb_tls_dir: tlsDir,
        mongodb_replicaset_name: database.config.replicaSetName || `rs_${safeName}`,
        mongodb_tls_validity_days: 3650,
        // Preserve user's cache size when regenerating config for TLS
        mongodb_cache_size_gb: database.config.cacheSizeGB || 0.5,
      };

      // Add DNS names to certificates if configured
      if (dnsHostnames.length > 0) {
        log(`Including DNS names in certificates: ${dnsHostnames.join(", ")}`);
        servers.forEach((s, i) => {
          if (dnsHostnames[i]) {
            extraVars[`mongodb_dns_name_${s.server.host.replace(/\./g, '_')}`] = dnsHostnames[i];
          }
        });
      }

      log("Starting TLS configuration playbook...");

      const result = await ansible.execPlaybook(
        { playbook: "mongodb-configure-tls.yml", inventory: inventoryPath, extraVars, verbose: true },
        log
      );

      if (result.success) {
        log("TLS playbook completed successfully");

        // Read CA certificate from the primary server for client distribution
        const primaryServer = servers.find((s) => s.node.role === "primary")?.server || servers[0].server;
        let caCert: string | undefined;

        try {
          log(`Reading CA certificate from ${primaryServer.host}...`);
          caCert = await readRemoteFile(primaryServer, `${tlsDir}/ca.crt`, sshKeyFile);
          log("CA certificate retrieved successfully");
        } catch (certErr: any) {
          log(`Warning: Could not retrieve CA certificate: ${certErr.message}`);
        }

        // Build TLS-enabled connection string
        const port = database.config.port || 27017;
        const replicaSetName = database.config.replicaSetName || `rs_${safeName}`;
        const hosts = servers.map((s) => `${s.server.host}:${port}`).join(",");
        const user = encodeURIComponent(database.credentials.adminUser);
        const password = encodeURIComponent(database.credentials.adminPassword);
        const tlsConnectionString = `mongodb://${user}:${password}@${hosts}/admin?replicaSet=${replicaSetName}&tls=true`;

        // Update database with TLS configuration
        await databaseRepo.updateById(databaseId, {
          config: {
            ...database.config,
            tlsEnabled: true,
            tlsDir,
          },
        });

        // Store full TLS config
        await databaseRepo.updateTLS(databaseId, {
          enabled: true,
          caCert: caCert || "",
          tlsConnectionString,
          configuredAt: new Date(),
        });

        // Also update the main connection string to use TLS
        await databaseRepo.updateById(databaseId, {
          credentials: {
            ...database.credentials,
            connectionString: tlsConnectionString,
          },
        });

        return { success: true, caCert, tlsConnectionString };
      } else {
        log("TLS configuration failed!");
        log(result.stderr);
        return { success: false, error: result.stderr || "Ansible playbook failed" };
      }
    } catch (error: any) {
      log(`TLS Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Read a file from a remote server via SSH
   */
  async function readRemoteFile(
    server: { host: string; sshUser: string; sshPort?: number },
    remotePath: string,
    sshKeyFile: string | null
  ): Promise<string> {
    const { spawn } = await import("child_process");

    return new Promise((resolve, reject) => {
      const sshArgs = [
        "-o", "StrictHostKeyChecking=no",
        "-o", "ConnectTimeout=10",
        "-p", String(server.sshPort || 22),
      ];
      if (sshKeyFile) {
        sshArgs.push("-i", sshKeyFile);
      }
      sshArgs.push(
        `${server.sshUser}@${server.host}`,
        `cat ${remotePath}`
      );

      let stdout = "";
      let stderr = "";

      const proc = spawn("ssh", sshArgs);

      proc.stdout?.on("data", (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on("data", (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on("close", (code) => {
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`SSH command failed (exit ${code}): ${stderr}`));
        }
      });

      proc.on("error", (err) => {
        reject(new Error(`SSH spawn error: ${err.message}`));
      });
    });
  }

  /**
   * Configure TLS for a MongoDB replica set (public API for manual TLS setup)
   */
  async function configureTLS(options: {
    databaseId: string;
    triggeredBy?: string;
    onLog?: (line: string) => void;
  }): Promise<{ success: boolean; error?: string; caCert?: string; tlsConnectionString?: string }> {
    const { databaseId, onLog } = options;
    let sshKeyFile: string | null = null;

    const log = (line: string) => {
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB TLS] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) throw new NotFoundError("Database not found");
      if (database.type !== "mongodb") throw new BadRequestError("TLS config only supported for MongoDB");
      if (database.status !== "running") throw new BadRequestError("Database must be running to configure TLS");
      if (database.nodes.length < 2) throw new BadRequestError("TLS requires a replica set (2+ nodes)");

      // Get server details
      const servers = await Promise.all(
        database.nodes.map(async (node) => {
          const server = await serverRepo.getById(node.serverId);
          if (!server) throw new NotFoundError(`Server not found: ${node.serverId}`);
          return { server, node };
        })
      );

      // Resolve SSH key
      sshKeyFile = await resolveSSHKeyFile(servers);

      // Get DNS hostnames for certificates (if configured)
      const dnsHostnames = database.dns?.nodeHosts || [];

      // Delegate to internal function
      return await configureTLSInternal({
        databaseId,
        servers,
        database,
        dnsHostnames,
        sshKeyFile,
        onLog: log,
      });
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message };
    } finally {
      cleanupKeyFile(sshKeyFile);
    }
  }

  return {
    provision,
    remove,
    addNode,
    removeNode: removeNodeFromCluster,
    getHealth,
    backup,
    restore,
    configureDNS,
    configureTLS,
  };
}

  // ---------------------------------------------------------------------------
  // SSH key helpers
  // ---------------------------------------------------------------------------

  /**
   * Write a private key string to a temp file (mode 0600) and return its path.
   * Caller is responsible for cleanup via cleanupKeyFile().
   */
  function writeKeyFile(privateKey: string): string {
    const tmpPath = path.join(os.tmpdir(), `cp_sshkey_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    fs.writeFileSync(tmpPath, privateKey, { mode: 0o600 });
    return tmpPath;
  }

  /** Delete a temp key file, ignoring errors (already cleaned up, etc.). */
  function cleanupKeyFile(keyFile: string | null): void {
    if (keyFile) {
      try { fs.unlinkSync(keyFile); } catch { /* ignore */ }
    }
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

function addCommonVars(lines: string[], sshKeyFile?: string): void {
  lines.push("[all:vars]");
  lines.push("ansible_python_interpreter=/usr/bin/python3");
  if (sshKeyFile) {
    lines.push(`ansible_ssh_private_key_file=${sshKeyFile}`);
  }
}

function buildStandaloneInventory(
  serverData: { server: any; node: TDatabaseNode },
  database: TDatabase,
  sshKeyFile?: string
): string {
  const { server, node } = serverData;
  const hostname = server.host.replace(/\./g, "_");

  const lines = [
    "[mongodb]",
    `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`,
    "",
  ];
  addCommonVars(lines, sshKeyFile);
  return lines.join("\n");
}

/**
 * Build a primary-only inventory for backup and restore playbooks.
 * Uses [mongodb_primary] group so the playbook's `hosts: mongodb_primary` resolves.
 * Works for both standalone (single node) and replica set databases.
 */
function buildBackupInventory(
  serverData: { server: any; node: TDatabaseNode },
  sshKeyFile?: string
): string {
  const { server, node } = serverData;
  const hostname = server.host.replace(/\./g, "_");

  const lines = [
    "[mongodb_primary]",
    `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort} mongodb_node_role=${node.role}`,
    "",
  ];
  addCommonVars(lines, sshKeyFile);
  return lines.join("\n");
}

function buildReplicaSetInventory(
  servers: Array<{ server: any; node: TDatabaseNode }>,
  database: TDatabase,
  sshKeyFile?: string
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
  addCommonVars(lines, sshKeyFile);

  return lines.join("\n");
}

function buildConversionInventory(
  primary: { server: any; node: TDatabaseNode },
  secondary: { server: any; node: TDatabaseNode },
  database: TDatabase,
  sshKeyFile?: string
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
  addCommonVars(lines, sshKeyFile);

  return lines.join("\n");
}

function buildConversionExtraVars(database: TDatabase): Record<string, any> {
  const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return {
    mongodb_version: database.version || "7.0",
    mongodb_admin_user: database.credentials.adminUser,
    mongodb_admin_password: database.credentials.adminPassword,
    mongodb_container_name: `mongodb_${safeName}`,
    mongodb_port: database.config.port || 27017,
    mongodb_data_dir: database.config.dataDir || `/opt/mongodb/${safeName}/data`,
    mongodb_config_dir: database.config.configDir || `/opt/mongodb/${safeName}/config`,
    mongodb_log_dir: database.config.logDir || `/opt/mongodb/${safeName}/logs`,
    mongodb_replicaset_name: database.config.replicaSetName || `rs_${safeName}`,
    mongodb_keyfile_dir: database.config.keyfileDir || `/opt/mongodb/${safeName}/keyfile`,
  };
}

function buildAddNodeInventory(
  existingServers: Array<{ server: any; node: TDatabaseNode }>,
  newNode: { server: any; node: TDatabaseNode },
  database: TDatabase,
  sshKeyFile?: string
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
  addCommonVars(lines, sshKeyFile);

  return lines.join("\n");
}

function buildRemoveNodeInventory(
  primary: { server: any; node: TDatabaseNode },
  nodeToRemove: { server: any; node: TDatabaseNode },
  database: TDatabase,
  sshKeyFile?: string
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
  addCommonVars(lines, sshKeyFile);

  return lines.join("\n");
}

function buildRemoveInventory(
  servers: Array<{ server: any; node: TDatabaseNode }>,
  database: TDatabase,
  sshKeyFile?: string
): string {
  const lines: string[] = ["[mongodb]"];

  for (const { server } of servers) {
    const hostname = server.host.replace(/\./g, "_");
    lines.push(
      `${hostname} ansible_host=${server.host} ansible_user=${server.sshUser} ansible_port=${server.sshPort}`
    );
  }

  lines.push("");
  addCommonVars(lines, sshKeyFile);

  return lines.join("\n");
}

function buildExtraVars(database: TDatabase, isReplicaSet: boolean): Record<string, any> {
  // Use database-name-scoped paths so multiple databases on the same server
  // don't collide. Names are sanitised to valid filesystem characters.
  const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");

  const vars: Record<string, any> = {
    mongodb_version: database.version || "7.0",
    mongodb_admin_user: database.credentials.adminUser,
    mongodb_admin_password: database.credentials.adminPassword,
    mongodb_container_name: `mongodb_${safeName}`,
    mongodb_port: database.config.port || 27017,
    mongodb_data_dir: database.config.dataDir || `/opt/mongodb/${safeName}/data`,
    mongodb_config_dir: database.config.configDir || `/opt/mongodb/${safeName}/config`,
    mongodb_log_dir: database.config.logDir || `/opt/mongodb/${safeName}/logs`,
  };

  if (isReplicaSet) {
    vars.mongodb_replicaset_name = database.config.replicaSetName || `rs_${safeName}`;
    vars.mongodb_keyfile_dir = database.config.keyfileDir || `/opt/mongodb/${safeName}/keyfile`;
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
