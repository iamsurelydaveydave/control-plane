import { ObjectId } from "mongodb";
import { Client, ConnectConfig } from "ssh2";
import { useK8sService, TK8sResource } from "./k8s.service";
import { useServerRepo } from "../resources/server";
import { useDatabaseRepo, TDatabase, TDatabaseNode } from "../resources/database";
import { useDeploymentRepo } from "../resources/deployment";
import { useSSHKeyService } from "../resources/ssh-key";
import { logger, BadRequestError, NotFoundError, InternalServerError } from "../utils";

// Percona MongoDB Operator API
const PERCONA_API_VERSION = "psmdb.percona.com/v1";
const PERCONA_KIND = "PerconaServerMongoDB";
const DATABASES_NAMESPACE = "databases";

// Use same types as Ansible provisioner for compatibility
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

export type TConfigureTLSOptions = {
  databaseId: string;
  triggeredBy: string;
  onLog?: (line: string) => void;
};

export type TProvisionOptions = {
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

export type THealthCheckResult = {
  status: string;
  members: Array<{
    host: string;
    state: string;
    health: number;
  }>;
};

/**
 * MongoDB Provisioner using Kubernetes + Percona Operator
 * 
 * This replaces the Ansible-based provisioner with a K8s-native approach.
 * The Percona Operator handles all the complexity of:
 * - Replica set initialization
 * - User creation
 * - TLS configuration
 * - Backups
 * - Scaling
 */
export function useMongoDBProvisionerK8s() {
  const k8s = useK8sService();
  const serverRepo = useServerRepo();
  const databaseRepo = useDatabaseRepo();
  const deploymentRepo = useDeploymentRepo();
  const sshKeyService = useSSHKeyService();

  /**
   * Provision a MongoDB cluster using Percona Operator
   */
  async function provision(options: TProvisionOptions): Promise<TProvisionResult> {
    const { databaseId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    let deploymentId: ObjectId | null = null;

    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB K8s] ${line}` });
    };

    try {
      // 1. Get database configuration
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      if (database.type !== "mongodb") {
        throw new BadRequestError("This provisioner only supports MongoDB");
      }

      log(`Starting MongoDB provisioning for: ${database.name}`);
      log(`Version: ${database.version}`);
      log(`Nodes: ${database.nodes.length}`);
      log(`Mode: Kubernetes + Percona Operator`);

      // 2. Update status and create deployment record
      await databaseRepo.updateStatus(databaseId, "provisioning");

      deploymentId = await deploymentRepo.add({
        appId: databaseId,
        image: `percona/percona-server-mongodb:${database.version}`,
        triggeredBy: triggeredBy || new ObjectId().toHexString(),
      });
      await deploymentRepo.updateStatus(deploymentId, "running");

      // 3. Check K8s is available
      log("Checking Kubernetes availability...");
      const k8sAvailable = await k8s.isAvailable();
      if (!k8sAvailable) {
        throw new InternalServerError(
          "Kubernetes is not available. Run k8s/setup-k3s-server.sh first."
        );
      }
      log("Kubernetes is available");

      // 4. Ensure all database servers are K3s agents (install in parallel)
      log("Verifying servers are K3s agents...");
      const servers = await getServersForDatabase(database);
      const k8sNodes = await k8s.getNodes();
      const k8sNodeIPs = k8sNodes.map((n: any) => 
        n.status?.addresses?.find((a: any) => a.type === "InternalIP")?.address
      ).filter(Boolean);

      const agentInstalls = servers
        .filter(({ server }) => !k8sNodeIPs.includes(server.host))
        .map(async ({ server }) => {
          log(`Server ${server.host} is not a K3s agent. Installing...`);
          await installK3sAgent(server, log);
        });
      
      if (agentInstalls.length > 0) {
        await Promise.all(agentInstalls);
      }
      log("All servers are K3s agents");

      // 5. Create secrets for MongoDB users
      log("Creating MongoDB secrets...");
      const secretName = `${database.name}-secrets`;
      await k8s.createSecret(
        secretName,
        DATABASES_NAMESPACE,
        {
          MONGODB_BACKUP_USER: "backup",
          MONGODB_BACKUP_PASSWORD: generatePassword(),
          MONGODB_CLUSTER_ADMIN_USER: "clusterAdmin",
          MONGODB_CLUSTER_ADMIN_PASSWORD: generatePassword(),
          MONGODB_CLUSTER_MONITOR_USER: "clusterMonitor",
          MONGODB_CLUSTER_MONITOR_PASSWORD: generatePassword(),
          MONGODB_USER_ADMIN_USER: database.credentials.adminUser,
          MONGODB_USER_ADMIN_PASSWORD: database.credentials.adminPassword,
        },
        { "app.kubernetes.io/instance": database.name }
      );
      log(`Secret created: ${secretName}`);

      // 6. Create PerconaServerMongoDB resource
      log("Creating PerconaServerMongoDB resource...");
      const psmdb = buildPerconaServerMongoDB(database, servers);
      await k8s.apply(psmdb);
      log(`PerconaServerMongoDB created: ${database.name}`);

      // 7. Wait for cluster to be ready
      log("Waiting for MongoDB cluster to be ready...");
      log("This may take 5-10 minutes for initial setup...");

      const readyResource = await k8s.waitForCondition(
        PERCONA_API_VERSION,
        PERCONA_KIND,
        database.name,
        DATABASES_NAMESPACE,
        (resource) => {
          const state = (resource as any).status?.state;
          log(`  Cluster state: ${state || "initializing"}`);
          return state === "ready";
        },
        600000 // 10 minute timeout
      );

      log("MongoDB cluster is ready!");

      // 8. Get connection info using external server IPs
      const connectionString = buildConnectionString(database, servers);

      // 9. Update database record
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
      await databaseRepo.updateById(databaseId, { nodes: database.nodes });

      // 10. Update deployment status
      await deploymentRepo.updateStatus(deploymentId, "success", logs.join("\n"));

      log("");
      log("=".repeat(60));
      log("MongoDB cluster provisioned successfully!");
      log(`Connection string: ${maskPassword(connectionString)}`);
      log("=".repeat(60));

      return {
        success: true,
        connectionString,
        logs,
      };
    } catch (error: any) {
      log(`Error: ${error.message}`);

      if (deploymentId) {
        await deploymentRepo.updateStatus(deploymentId, "failed", logs.join("\n")).catch(() => {});
      }
      await databaseRepo.updateStatus(databaseId, "failed").catch(() => {});

      return {
        success: false,
        error: error.message,
        logs,
      };
    }
  }

  /**
   * Remove a MongoDB cluster
   */
  async function remove(
    databaseId: string,
    keepData: boolean = false,
    onLog?: (line: string) => void
  ): Promise<TProvisionResult> {
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB K8s Remove] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log(`Removing MongoDB cluster: ${database.name}`);

      // Delete the PerconaServerMongoDB resource
      try {
        await k8s.remove(
          PERCONA_API_VERSION,
          PERCONA_KIND,
          database.name,
          DATABASES_NAMESPACE
        );
        log("PerconaServerMongoDB resource deleted");
      } catch (err: any) {
        if (err.statusCode !== 404) {
          throw err;
        }
        log("PerconaServerMongoDB resource already deleted");
      }

      // Delete secrets
      try {
        await k8s.remove("v1", "Secret", `${database.name}-secrets`, DATABASES_NAMESPACE);
        log("Secrets deleted");
      } catch (err: any) {
        if (err.statusCode !== 404) {
          log(`Warning: Failed to delete secrets: ${err.message}`);
        }
      }

      // If not keeping data, delete PVCs
      if (!keepData) {
        log("Deleting persistent volume claims...");
        const pvcs = await k8s.list(
          "v1",
          "PersistentVolumeClaim",
          DATABASES_NAMESPACE,
          `app.kubernetes.io/instance=${database.name}`
        );
        for (const pvc of pvcs) {
          await k8s.remove("v1", "PersistentVolumeClaim", pvc.metadata.name, DATABASES_NAMESPACE);
          log(`  Deleted PVC: ${pvc.metadata.name}`);
        }
      }

      // Update database status
      await databaseRepo.updateStatus(databaseId, "stopped");

      log("MongoDB cluster removed successfully");

      return { success: true, logs };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  /**
   * Get health status of a MongoDB cluster
   */
  async function getHealth(databaseId: string): Promise<THealthCheckResult> {
    const database = await databaseRepo.getById(databaseId);
    if (!database) {
      throw new NotFoundError("Database not found");
    }

    const resource = await k8s.get<any>(
      PERCONA_API_VERSION,
      PERCONA_KIND,
      database.name,
      DATABASES_NAMESPACE
    );

    if (!resource) {
      return {
        status: "not_found",
        members: [],
      };
    }

    const state = resource.status?.state || "unknown";
    const replsets = resource.status?.replsets || {};
    const members: THealthCheckResult["members"] = [];

    for (const [rsName, rsStatus] of Object.entries(replsets) as any) {
      for (const member of rsStatus?.members || []) {
        members.push({
          host: member.name || "unknown",
          state: member.state || "unknown",
          health: member.state === "PRIMARY" || member.state === "SECONDARY" ? 1 : 0,
        });
      }
    }

    return {
      status: state === "ready" ? "healthy" : state,
      members,
    };
  }

  /**
   * Add a node to an existing cluster
   */
  async function addNode(options: TAddNodeOptions): Promise<TProvisionResult> {
    const { databaseId, serverId, role, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB K8s AddNode] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      const newServer = await serverRepo.getById(serverId);
      if (!newServer) {
        throw new NotFoundError(`Server not found: ${serverId}`);
      }

      log(`Adding node ${newServer.host} as ${role}`);

      // Ensure server is a K3s agent
      const k8sNodes = await k8s.getNodes();
      const k8sNodeIPs = k8sNodes.map((n: any) =>
        n.status?.addresses?.find((a: any) => a.type === "InternalIP")?.address
      ).filter(Boolean);

      if (!k8sNodeIPs.includes(newServer.host)) {
        log(`Installing K3s agent on ${newServer.host}...`);
        await installK3sAgent(newServer, log);
      }

      // Add node to database record
      await databaseRepo.addNode(databaseId, {
        serverId: new ObjectId(serverId),
        role,
        status: "syncing",
      });

      // Get updated database
      const updatedDatabase = await databaseRepo.getById(databaseId);
      if (!updatedDatabase) {
        throw new Error("Database not found after update");
      }

      // Update the PerconaServerMongoDB resource with new replica count
      const servers = await getServersForDatabase(updatedDatabase);
      const psmdb = buildPerconaServerMongoDB(updatedDatabase, servers);
      await k8s.apply(psmdb);

      log("Waiting for cluster to scale...");

      // Wait for cluster to be ready with new node
      await k8s.waitForCondition(
        PERCONA_API_VERSION,
        PERCONA_KIND,
        database.name,
        DATABASES_NAMESPACE,
        (resource) => {
          const state = (resource as any).status?.state;
          const ready = (resource as any).status?.replsets?.rs0?.ready || 0;
          log(`  Cluster state: ${state}, ready members: ${ready}`);
          return state === "ready" && ready >= updatedDatabase.nodes.length;
        },
        300000
      );

      // Update node status
      await databaseRepo.updateNodeStatus(databaseId, serverId, "running");

      log("Node added successfully!");

      return { success: true, logs };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  /**
   * Remove a node from the cluster
   */
  async function removeNode(options: TRemoveNodeOptions): Promise<TProvisionResult> {
    const { databaseId, serverId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB K8s RemoveNode] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log(`Removing node ${serverId} from cluster`);

      // Remove from database record
      await databaseRepo.removeNode(databaseId, serverId);

      // Get updated database
      const updatedDatabase = await databaseRepo.getById(databaseId);
      if (!updatedDatabase) {
        throw new Error("Database not found after update");
      }

      if (updatedDatabase.nodes.length < 1) {
        throw new BadRequestError("Cannot remove the last node");
      }

      // Update the PerconaServerMongoDB resource with new replica count
      const servers = await getServersForDatabase(updatedDatabase);
      const psmdb = buildPerconaServerMongoDB(updatedDatabase, servers);
      await k8s.apply(psmdb);

      log("Waiting for cluster to scale down...");

      // Wait for cluster to be ready
      await k8s.waitForCondition(
        PERCONA_API_VERSION,
        PERCONA_KIND,
        database.name,
        DATABASES_NAMESPACE,
        (resource) => {
          const state = (resource as any).status?.state;
          return state === "ready";
        },
        300000
      );

      log("Node removed successfully!");

      return { success: true, logs };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  /**
   * Configure TLS on the cluster
   */
  async function configureTLS(options: TConfigureTLSOptions): Promise<TProvisionResult> {
    const { databaseId, triggeredBy, onLog } = options;
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
      logger.log({ level: "info", message: `[MongoDB K8s TLS] ${line}` });
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log("Enabling TLS on MongoDB cluster...");
      log("Note: Percona Operator handles TLS automatically via cert-manager");

      // The Percona Operator automatically handles TLS when configured
      // We just need to update the resource to enable it

      const servers = await getServersForDatabase(database);
      const psmdb = buildPerconaServerMongoDB(database, servers, { tlsEnabled: true });
      await k8s.apply(psmdb);

      // Wait for rolling restart
      log("Waiting for TLS configuration to apply...");
      await k8s.waitForCondition(
        PERCONA_API_VERSION,
        PERCONA_KIND,
        database.name,
        DATABASES_NAMESPACE,
        (resource) => (resource as any).status?.state === "ready",
        600000
      );

      // Update database record
      await databaseRepo.updateTLS(databaseId, {
        enabled: true,
        caCert: "", // Percona manages certs via secrets
        tlsConnectionString: database.credentials.connectionString + "&tls=true",
        configuredAt: new Date(),
      });

      log("TLS enabled successfully!");

      return { success: true, logs };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  // =========================================================================
  // Helper functions
  // =========================================================================

  async function getServersForDatabase(database: TDatabase) {
    return Promise.all(
      database.nodes.map(async (node) => {
        const server = await serverRepo.getById(node.serverId);
        if (!server) {
          throw new NotFoundError(`Server not found: ${node.serverId}`);
        }
        return { server, node };
      })
    );
  }

  async function installK3sAgent(server: any, log: (msg: string) => void) {
    // Get K3s server URL and token from environment
    // Use K3S_EXTERNAL_URL for agents (public IP), fallback to K3S_SERVER_URL
    const k3sServerUrl = process.env.K3S_EXTERNAL_URL || process.env.K3S_SERVER_URL;
    const k3sToken = process.env.K3S_TOKEN;

    if (!k3sServerUrl || !k3sToken) {
      throw new Error(
        "K3S_SERVER_URL and K3S_TOKEN environment variables must be set. " +
        "Get these from the control plane server after running setup-k3s-server.sh"
      );
    }

    log(`  Installing K3s agent on ${server.host}...`);

    // Get SSH key for the server
    let privateKey: string | undefined;
    if (server.sshKeyId) {
      const key = await sshKeyService.getFullById(String(server.sshKeyId));
      privateKey = key?.privateKey;
    }
    if (!privateKey) {
      const defaultKey = await sshKeyService.getDefaultFull();
      privateKey = defaultKey?.privateKey;
    }
    if (!privateKey) {
      throw new Error("No SSH key available for server connection");
    }

    // Connect via SSH and run the K3s install command
    const conn = new Client();
    const command = `curl -sfL https://get.k3s.io | K3S_URL=${k3sServerUrl} K3S_TOKEN=${k3sToken} sh -`;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        conn.end();
        reject(new Error("K3s agent installation timed out after 5 minutes"));
      }, 300000);

      conn.on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) {
            clearTimeout(timeout);
            conn.end();
            reject(err);
            return;
          }

          stream.on("close", (code: number) => {
            clearTimeout(timeout);
            conn.end();
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`K3s agent installation failed with code ${code}`));
            }
          });

          stream.on("data", (data: Buffer) => {
            log(`  [K3s] ${data.toString().trim()}`);
          });

          stream.stderr.on("data", (data: Buffer) => {
            log(`  [K3s stderr] ${data.toString().trim()}`);
          });
        });
      });

      conn.on("error", (err) => {
        clearTimeout(timeout);
        conn.end();
        reject(err);
      });

      const connectConfig: ConnectConfig = {
        host: server.host,
        port: server.sshPort || 22,
        username: server.sshUser || "root",
        privateKey,
        readyTimeout: 30000,
      };

      conn.connect(connectConfig);
    });

    // Wait for node to join
    log(`  Waiting for ${server.host} to join cluster...`);
    await new Promise((r) => setTimeout(r, 30000));
  }

  function buildPerconaServerMongoDB(
    database: TDatabase,
    servers: Array<{ server: any; node: TDatabaseNode }>,
    options: { tlsEnabled?: boolean } = {}
  ): TK8sResource {
    const replsetSize = servers.filter((s) => s.node.role !== "arbiter").length;
    const arbiterCount = servers.filter((s) => s.node.role === "arbiter").length;

    const safeName = database.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();

    return {
      apiVersion: PERCONA_API_VERSION,
      kind: PERCONA_KIND,
      metadata: {
        name: safeName,
        namespace: DATABASES_NAMESPACE,
        labels: {
          "app.kubernetes.io/name": "percona-server-mongodb",
          "app.kubernetes.io/instance": safeName,
          "control-plane/database-id": String(database._id),
        },
      },
      spec: {
        crVersion: "1.16.0",
        image: `percona/percona-server-mongodb:${database.version || "7.0"}`,
        imagePullPolicy: "IfNotPresent",

        // Secrets for users
        secrets: {
          users: `${safeName}-secrets`,
        },

        // Replica set configuration
        replsets: [
          {
            name: "rs0",
            size: replsetSize,
            arbiter: arbiterCount > 0 ? { enabled: true, size: arbiterCount } : undefined,

            // Expose MongoDB externally via NodePort on each node
            expose: {
              enabled: true,
              exposeType: "NodePort",
            },

            // Storage
            volumeSpec: {
              persistentVolumeClaim: {
                resources: {
                  requests: {
                    storage: database.config.storageSizeGB
                      ? `${database.config.storageSizeGB}Gi`
                      : "10Gi",
                  },
                },
              },
            },

            // Resources
            resources: {
              limits: {
                cpu: database.config.cpuLimit || "1",
                memory: database.config.memoryLimit || "2Gi",
              },
              requests: {
                cpu: database.config.cpuRequest || "500m",
                memory: database.config.memoryRequest || "1Gi",
              },
            },

            // Node affinity - schedule on specific servers
            affinity: {
              podAntiAffinity: {
                requiredDuringSchedulingIgnoredDuringExecution: [
                  {
                    labelSelector: {
                      matchLabels: {
                        "app.kubernetes.io/instance": safeName,
                      },
                    },
                    topologyKey: "kubernetes.io/hostname",
                  },
                ],
              },
            },
          },
        ],

        // Sharding disabled (replica set only)
        sharding: {
          enabled: false,
        },

        // TLS configuration
        ...(options.tlsEnabled && {
          tls: {
            mode: "requireTLS",
            // Percona Operator auto-generates certs if cert-manager is installed
            // Otherwise, you'd specify certSecret and caSecret here
          },
        }),

        // Backup configuration (can be enabled later)
        backup: {
          enabled: false,
        },
      },
    };
  }

  /**
   * Build connection string using external server IPs
   * This makes the MongoDB cluster accessible from outside K8s
   */
  function buildConnectionString(
    database: TDatabase,
    servers: Array<{ server: any; node: TDatabaseNode }>
  ): string {
    // Use external server IPs with default MongoDB port
    // NodePort exposes on the same port (27017) on each node
    const hosts = servers
      .filter((s) => s.node.role !== "arbiter")
      .map((s) => `${s.server.host}:27017`)
      .join(",");
    
    const user = encodeURIComponent(database.credentials.adminUser);
    const password = encodeURIComponent(database.credentials.adminPassword);
    const replicaSetName = "rs0";

    return `mongodb://${user}:${password}@${hosts}/admin?replicaSet=${replicaSetName}`;
  }

  function generatePassword(): string {
    const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    let password = "";
    for (let i = 0; i < 24; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return password;
  }

  function maskPassword(connectionString: string): string {
    return connectionString.replace(/:[^:@]+@/, ":****@");
  }

  /**
   * Backup a MongoDB cluster (Percona Operator handles this)
   */
  async function backup(options: {
    databaseId: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }): Promise<TProvisionResult & { s3Key?: string }> {
    const { databaseId, onLog } = options;
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log("Backup via Percona Operator is configured in the PerconaServerMongoDB resource.");
      log("To enable automatic backups, update the backup section in the resource.");
      log("Manual backup trigger is not yet implemented for K8s provisioner.");

      // TODO: Implement backup trigger via Percona Operator
      // This would create a PerconaServerMongoDBBackup resource

      return {
        success: true,
        logs,
        s3Key: undefined,
      };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  /**
   * Restore a MongoDB cluster from backup
   */
  async function restore(options: {
    databaseId: string;
    s3Key: string;
    triggeredBy: string;
    onLog?: (line: string) => void;
  }): Promise<TProvisionResult> {
    const { databaseId, onLog } = options;
    const logs: string[] = [];
    const log = (line: string) => {
      logs.push(line);
      if (onLog) onLog(line);
    };

    try {
      const database = await databaseRepo.getById(databaseId);
      if (!database) {
        throw new NotFoundError("Database not found");
      }

      log("Restore via Percona Operator is not yet implemented.");
      log("To restore, create a PerconaServerMongoDBRestore resource.");

      // TODO: Implement restore via Percona Operator

      return { success: true, logs };
    } catch (error: any) {
      log(`Error: ${error.message}`);
      return { success: false, error: error.message, logs };
    }
  }

  /**
   * Configure DNS for the MongoDB cluster
   * With K8s, DNS is handled by CoreDNS/cluster DNS
   */
  async function configureDNS(databaseId: string): Promise<any> {
    const database = await databaseRepo.getById(databaseId);
    if (!database) {
      throw new NotFoundError("Database not found");
    }

    // In K8s, the service DNS is automatic
    const safeName = database.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    const clusterHost = `${safeName}-rs0.${DATABASES_NAMESPACE}.svc.cluster.local`;

    return {
      enabled: true,
      provider: "kubernetes",
      clusterHost,
      nodeHosts: [clusterHost],
      srvConnectionString: `mongodb+srv://${database.credentials.adminUser}:***@${clusterHost}`,
      records: [],
      configuredAt: new Date(),
    };
  }

  return {
    provision,
    remove,
    getHealth,
    addNode,
    removeNode,
    configureTLS,
    backup,
    restore,
    configureDNS,
  };
}
