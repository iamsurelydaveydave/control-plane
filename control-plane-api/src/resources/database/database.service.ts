import { ObjectId } from "mongodb";
import { useDatabaseRepo } from "./database.repository";
import { useKubernetesService } from "../../services/kubernetes.service";
import { useDNSService, TDNSReplicaSetResult } from "../../services/dns.service";
import { TDatabase, TDatabaseStatus, modelDatabase, TDatabaseInput, TDatabaseNodeRole, TBackupConfigInput, TBackupInfo, TDatabaseBackup } from "./database.model";
import { BadRequestError, NotFoundError, InternalServerError } from "../../utils/error";
import { logger } from "../../utils";
import { useWebhookService } from "../webhook/webhook.service";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DB_NAMESPACE = "cp-databases";

// Percona Server for MongoDB Operator CRD
const PSMDB_GROUP = "psmdb.percona.com";
const PSMDB_VERSION = "v1";
const PSMDB_PLURAL = "perconaservermongodbs";

// Environment flag for K8s integration
const K8S_ENABLED = process.env.K8S_ENABLED === "true";

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export function useDatabaseService() {
  const repo = useDatabaseRepo();
  const k8s = useKubernetesService();
  const dns = useDNSService();
  const webhookService = useWebhookService();

  /**
   * Create a new database
   * 1. Validate input and create database record
   * 2. If K8s enabled, create PerconaServerMongoDB custom resource
   * 3. Return database ID for status polling
   */
  async function create(data: TDatabaseInput): Promise<{ databaseId: string; message: string }> {
    // Validate and build database document
    const database = modelDatabase(data);

    // Check for duplicate name
    const existing = await repo.getByName(database.name);
    if (existing) {
      throw new BadRequestError(`Database with name '${database.name}' already exists.`);
    }

    // Insert database record
    const databaseId = await repo.add(database);

    // Trigger webhook notification for database creation
    webhookService.trigger("database.created", {
      databaseId,
      databaseName: database.name,
      databaseType: database.type,
      createdAt: new Date().toISOString(),
    });

    logger.log({
      level: "info",
      message: `[Database] Created database record: ${database.name} (${databaseId})`,
    });

    // Trigger provisioning (async)
    if (K8S_ENABLED) {
      triggerK8sProvisioning(databaseId, database).catch((err) => {
        logger.log({
          level: "error",
          message: `[Database] K8s provisioning failed for ${database.name}: ${err.message}`,
        });
        repo.updateStatus(databaseId, "failed").catch(() => {});
      });
    } else {
      // Non-K8s mode: just log that external provisioning is expected
      logger.log({
        level: "info",
        message: `[Database] K8s disabled — external provisioning expected for ${database.name}`,
      });
      await repo.appendLog(databaseId, `[${new Date().toISOString()}] Database record created. K8s disabled — awaiting external provisioning.`);
    }

    return {
      databaseId,
      message: K8S_ENABLED
        ? "Database provisioning started"
        : "Database record created. External provisioning required.",
    };
  }

  /**
   * Trigger K8s provisioning via Percona Operator
   */
  async function triggerK8sProvisioning(
    databaseId: string,
    database: Omit<TDatabase, "_id">
  ): Promise<void> {
    try {
      k8s.init();

      await repo.appendLog(databaseId, `[${new Date().toISOString()}] Starting K8s provisioning...`);

      // Ensure namespace exists
      try {
        await k8s.createNamespace(DB_NAMESPACE);
        await repo.appendLog(databaseId, `[${new Date().toISOString()}] Namespace ${DB_NAMESPACE} ready.`);
      } catch (err: any) {
        // Namespace might already exist
        if (!err.message?.includes("already exists")) {
          throw err;
        }
      }

      // Build Percona PSMDB custom resource
      const psmdbResource = buildPSMDBResource(database);

      await repo.appendLog(databaseId, `[${new Date().toISOString()}] Creating PerconaServerMongoDB resource...`);

      // Create the custom resource
      await k8s.createCustomResource(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        PSMDB_PLURAL,
        psmdbResource
      );

      await repo.appendLog(databaseId, `[${new Date().toISOString()}] PerconaServerMongoDB resource created.`);
      await repo.updateStatus(databaseId, "provisioning");

      logger.log({
        level: "info",
        message: `[Database] K8s provisioning initiated for ${database.name}`,
      });
    } catch (err: any) {
      await repo.appendLog(databaseId, `[${new Date().toISOString()}] ERROR: ${err.message}`);

      // Trigger webhook notification for failure
      webhookService.trigger("database.failed", {
        databaseId,
        databaseName: database.name,
        databaseType: database.type,
        error: err.message,
        failedAt: new Date().toISOString(),
      });

      throw err;
    }
  }

  /**
   * Build a PerconaServerMongoDB custom resource manifest
   */
  function buildPSMDBResource(database: Omit<TDatabase, "_id">): object {
    const replicas = database.nodes.filter((n) => n.role !== "arbiter").length;
    const arbiters = database.nodes.filter((n) => n.role === "arbiter").length;

    return {
      apiVersion: `${PSMDB_GROUP}/${PSMDB_VERSION}`,
      kind: "PerconaServerMongoDB",
      metadata: {
        name: database.name,
        namespace: DB_NAMESPACE,
        labels: {
          "app.kubernetes.io/managed-by": "control-plane",
          "control-plane/database-type": database.type,
        },
      },
      spec: {
        image: `percona/percona-server-mongodb:${database.version}`,
        imagePullPolicy: "IfNotPresent",
        replsets: [
          {
            name: database.config.replicaSetName,
            size: replicas,
            arbiter: {
              enabled: arbiters > 0,
              size: arbiters,
            },
            configuration: database.config.cacheSizeGB
              ? `storage:\n  wiredTiger:\n    engineConfig:\n      cacheSizeGB: ${database.config.cacheSizeGB}`
              : undefined,
            expose: {
              enabled: true,
              exposeType: "ClusterIP",
            },
          },
        ],
        secrets: {
          users: `${database.name}-secrets`,
        },
        users: [
          {
            name: database.credentials.adminUser,
            db: "admin",
            passwordSecretRef: {
              name: `${database.name}-secrets`,
              key: "MONGODB_DATABASE_ADMIN_PASSWORD",
            },
            roles: [
              { name: "root", db: "admin" },
            ],
          },
        ],
      },
    };
  }

  /**
   * Delete a database
   * 1. If K8s enabled, delete the PSMDB custom resource
   * 2. Clean up DNS records if configured
   * 3. Delete database record
   */
  async function remove(
    id: string,
    options: { force?: boolean } = {}
  ): Promise<{ message: string; errors: string[] }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    const errors: string[] = [];

    // Clean up DNS records
    if (database.dns?.records?.length) {
      try {
        await dns.teardown(database.dns.records);
        logger.log({
          level: "info",
          message: `[Database] DNS records removed for ${database.name}`,
        });
      } catch (err: any) {
        errors.push(`DNS cleanup failed: ${err.message}`);
        logger.log({
          level: "warn",
          message: `[Database] DNS cleanup failed for ${database.name}: ${err.message}`,
        });
      }
    }

    // Delete K8s resources
    if (K8S_ENABLED) {
      try {
        k8s.init();
        await k8s.deleteCustomResource(
          PSMDB_GROUP,
          PSMDB_VERSION,
          DB_NAMESPACE,
          PSMDB_PLURAL,
          database.name
        );
        logger.log({
          level: "info",
          message: `[Database] K8s resource deleted for ${database.name}`,
        });
      } catch (err: any) {
        // Ignore not found errors - resource may already be deleted
        if (!err.message?.includes("not found") && err.statusCode !== 404) {
          errors.push(`K8s cleanup failed: ${err.message}`);
          logger.log({
            level: "warn",
            message: `[Database] K8s cleanup failed for ${database.name}: ${err.message}`,
          });
          if (!options.force) {
            throw new InternalServerError(`Failed to delete K8s resources: ${err.message}. Use force=true to delete anyway.`);
          }
        }
      }

      // Clean up the associated K8s secret
      try {
        await k8s.deleteSecret(DB_NAMESPACE, `${database.name}-secrets`);
        logger.log({
          level: "info",
          message: `[Database] K8s secret deleted for ${database.name}`,
        });
      } catch (err: any) {
        // Ignore not found errors - secret may not exist
        if (!err.message?.includes("not found") && err.statusCode !== 404) {
          errors.push(`Secret cleanup failed: ${err.message}`);
          logger.log({
            level: "warn",
            message: `[Database] Secret cleanup failed for ${database.name}: ${err.message}`,
          });
        }
      }

      // Clean up backup credentials secret if exists
      if (database.backup?.credentialsSecret) {
        try {
          await k8s.deleteSecret(DB_NAMESPACE, database.backup.credentialsSecret);
          logger.log({
            level: "info",
            message: `[Database] Backup credentials secret deleted for ${database.name}`,
          });
        } catch (err: any) {
          if (!err.message?.includes("not found") && err.statusCode !== 404) {
            errors.push(`Backup secret cleanup failed: ${err.message}`);
          }
        }
      }
    }

    // Delete database record
    await repo.deleteById(id);

    // Trigger webhook notification
    webhookService.trigger("database.deleted", {
      databaseId: id,
      databaseName: database.name,
      databaseType: database.type,
      deletedAt: new Date().toISOString(),
    });

    logger.log({
      level: "info",
      message: `[Database] Deleted database ${database.name}`,
    });

    return {
      message: `Database ${database.name} deleted.`,
      errors,
    };
  }

  /**
   * Re-provision a database
   * Deletes and recreates the K8s resource to trigger a fresh deployment
   */
  async function reprovision(id: string): Promise<{ message: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!K8S_ENABLED) {
      // In non-K8s mode, just update status and log
      await repo.updateStatus(id, "provisioning");
      await repo.clearLogs(id);
      await repo.appendLog(id, `[${new Date().toISOString()}] Reprovision requested. K8s disabled — awaiting external provisioning.`);
      
      return {
        message: "Reprovision requested. External provisioning required.",
      };
    }

    try {
      k8s.init();

      await repo.updateStatus(id, "provisioning");
      await repo.clearLogs(id);
      await repo.appendLog(id, `[${new Date().toISOString()}] Starting reprovision...`);

      // Delete existing resource (if any)
      try {
        await k8s.deleteCustomResource(
          PSMDB_GROUP,
          PSMDB_VERSION,
          DB_NAMESPACE,
          PSMDB_PLURAL,
          database.name
        );
        await repo.appendLog(id, `[${new Date().toISOString()}] Deleted existing PSMDB resource.`);
        
        // Wait a bit for cleanup
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err: any) {
        // Resource might not exist
        await repo.appendLog(id, `[${new Date().toISOString()}] No existing resource to delete.`);
      }

      // Recreate
      const psmdbResource = buildPSMDBResource(database);
      await k8s.createCustomResource(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        PSMDB_PLURAL,
        psmdbResource
      );

      await repo.appendLog(id, `[${new Date().toISOString()}] PerconaServerMongoDB resource recreated.`);

      logger.log({
        level: "info",
        message: `[Database] Reprovision initiated for ${database.name}`,
      });

      return {
        message: "Reprovision started successfully.",
      };
    } catch (err: any) {
      await repo.appendLog(id, `[${new Date().toISOString()}] ERROR: ${err.message}`);
      await repo.updateStatus(id, "failed");
      throw new InternalServerError(`Reprovision failed: ${err.message}`);
    }
  }

  /**
   * Get replica set health status
   * Queries the MongoDB replica set status via the operator or direct connection
   */
  async function getHealth(id: string): Promise<{
    status: string;
    members: Array<{ host: string; state: string; health: number }>;
  }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!K8S_ENABLED) {
      // Non-K8s mode: return status based on database record
      return {
        status: database.status === "running" ? "healthy" : database.status,
        members: database.nodes.map((node, i) => ({
          host: node.sslipHost || `node${i + 1}`,
          state: node.role === "primary" ? "PRIMARY" : node.role === "secondary" ? "SECONDARY" : "ARBITER",
          health: node.status === "running" ? 1 : 0,
        })),
      };
    }

    try {
      k8s.init();

      // Get PSMDB status from K8s
      const psmdb = await k8s.getCustomResource(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        PSMDB_PLURAL,
        database.name
      ) as any;

      if (!psmdb) {
        return { status: "not_found", members: [] };
      }

      const psmdbStatus = psmdb.status || {};
      const replicaSetName = database.config.replicaSetName || "rs0";
      const replsetStatus = psmdbStatus.replsets?.[replicaSetName] || {};

      // Map replset members to health response
      const members = (replsetStatus.members || []).map((member: any) => ({
        host: member.name || "unknown",
        state: member.state || "UNKNOWN",
        health: member.health ?? 0,
      }));

      return {
        status: psmdbStatus.state || "unknown",
        members,
      };
    } catch (err: any) {
      logger.log({
        level: "warn",
        message: `[Database] Failed to get health for ${database.name}: ${err.message}`,
      });
      return { status: "error", members: [] };
    }
  }

  /**
   * Configure DNS for a database
   * Creates A records, SRV records, and TXT record for mongodb+srv:// connections
   */
  async function configureDNS(id: string): Promise<TDNSReplicaSetResult | null> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (database.dns?.enabled) {
      throw new BadRequestError("DNS is already configured for this database.");
    }

    // Get node IPs (for K8s, these would be service IPs; for non-K8s, from the server records)
    // For now, we'll need the caller to have populated sslipHost or we'll use placeholder IPs
    const nodes = database.nodes.map((node, i) => ({
      host: node.sslipHost?.split(".").slice(-4, -1).join(".") || `10.0.0.${i + 1}`, // Extract IP from sslip or use placeholder
      port: database.config.port || 27017,
    }));

    const result = await dns.setupReplicaSet({
      databaseName: database.name,
      nodes,
      adminUser: database.credentials.adminUser,
      adminPassword: database.credentials.adminPassword,
      replicaSetName: database.config.replicaSetName || "rs0",
    });

    if (!result) {
      throw new BadRequestError("DNS configuration not available. Check DNS settings.");
    }

    // Save DNS config to database record
    await repo.updateDNS(id, {
      enabled: true,
      provider: "cloudflare",
      clusterHost: result.clusterHost,
      nodeHosts: result.nodeHosts,
      srvConnectionString: result.srvConnectionString,
      records: result.records,
      configuredAt: new Date(),
    });

    logger.log({
      level: "info",
      message: `[Database] DNS configured for ${database.name}: ${result.clusterHost}`,
    });

    return result;
  }

  /**
   * Remove DNS configuration from a database
   */
  async function removeDNS(id: string): Promise<{ message: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!database.dns?.enabled) {
      throw new BadRequestError("DNS is not configured for this database.");
    }

    // Delete DNS records
    if (database.dns.records?.length) {
      await dns.teardown(database.dns.records);
    }

    // Remove DNS config from database record
    await repo.removeDNS(id);

    logger.log({
      level: "info",
      message: `[Database] DNS removed for ${database.name}`,
    });

    return {
      message: "DNS configuration removed.",
    };
  }

  /**
   * Add a node to an existing database
   */
  async function addNode(
    id: string,
    node: { serverId: string; role: TDatabaseNodeRole }
  ): Promise<{ message: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    // Check if server is already a node
    const existingNode = database.nodes.find(
      (n) => n.serverId.toString() === node.serverId
    );
    if (existingNode) {
      throw new BadRequestError("Server is already a node in this database.");
    }

    let serverOid: ObjectId;
    try {
      serverOid = new ObjectId(node.serverId);
    } catch {
      throw new BadRequestError("Invalid server ID format.");
    }

    await repo.addNode(id, {
      serverId: serverOid,
      role: node.role,
      status: "stopped",
    });

    // If K8s enabled, update the PSMDB resource
    if (K8S_ENABLED) {
      try {
        k8s.init();
        const updatedDb = await repo.getById(id);
        if (updatedDb) {
          const psmdbResource = buildPSMDBResource(updatedDb);
          await k8s.updateCustomResource(
            PSMDB_GROUP,
            PSMDB_VERSION,
            DB_NAMESPACE,
            PSMDB_PLURAL,
            database.name,
            psmdbResource
          );
        }
      } catch (err: any) {
        logger.log({
          level: "warn",
          message: `[Database] Failed to update K8s resource after adding node: ${err.message}`,
        });
      }
    }

    logger.log({
      level: "info",
      message: `[Database] Added node ${node.serverId} (${node.role}) to ${database.name}`,
    });

    return {
      message: `Node added as ${node.role}.`,
    };
  }

  /**
   * Remove a node from a database
   */
  async function removeNode(id: string, serverId: string): Promise<{ message: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    const node = database.nodes.find((n) => n.serverId.toString() === serverId);
    if (!node) {
      throw new NotFoundError("Node not found in this database.");
    }

    // Don't allow removing the last node
    if (database.nodes.length === 1) {
      throw new BadRequestError("Cannot remove the last node. Delete the database instead.");
    }

    // Don't allow removing the primary if there are no other eligible nodes
    if (node.role === "primary") {
      const secondaries = database.nodes.filter((n) => n.role === "secondary");
      if (secondaries.length === 0) {
        throw new BadRequestError("Cannot remove primary without a secondary to promote.");
      }
    }

    await repo.removeNode(id, serverId);

    // If K8s enabled, update the PSMDB resource
    if (K8S_ENABLED) {
      try {
        k8s.init();
        const updatedDb = await repo.getById(id);
        if (updatedDb) {
          const psmdbResource = buildPSMDBResource(updatedDb);
          await k8s.updateCustomResource(
            PSMDB_GROUP,
            PSMDB_VERSION,
            DB_NAMESPACE,
            PSMDB_PLURAL,
            database.name,
            psmdbResource
          );
        }
      } catch (err: any) {
        logger.log({
          level: "warn",
          message: `[Database] Failed to update K8s resource after removing node: ${err.message}`,
        });
      }
    }

    logger.log({
      level: "info",
      message: `[Database] Removed node ${serverId} from ${database.name}`,
    });

    return {
      message: "Node removed from database.",
    };
  }

  /**
   * Get deployment logs for a database
   */
  async function getLogs(id: string): Promise<{ logs: string[] }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    return {
      logs: database.deploymentLogs || [],
    };
  }

  // ---------------------------------------------------------------------------
  // TLS Management
  // ---------------------------------------------------------------------------

  /**
   * Enable TLS for a database
   * 
   * For K8s/Percona:
   * 1. Update the PSMDB custom resource to enable TLS (mode: requireTLS)
   * 2. Wait for cert-manager to generate certificates
   * 3. Read the CA certificate from the K8s secret
   * 4. Update the database record with TLS config
   */
  async function enableTLS(id: string): Promise<{ message: string; tlsConnectionString?: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (database.tls?.enabled) {
      throw new BadRequestError("TLS is already enabled for this database.");
    }

    if (database.status !== "running") {
      throw new BadRequestError("Database must be running to enable TLS.");
    }

    await repo.appendLog(id, `[${new Date().toISOString()}] Enabling TLS...`);

    let caCert = "";
    let tlsConnectionString = "";

    if (K8S_ENABLED) {
      try {
        k8s.init();

        // Update the PSMDB resource to enable TLS
        const psmdbResource = buildPSMDBResourceWithTLS(database, true);
        await k8s.updateCustomResource(
          PSMDB_GROUP,
          PSMDB_VERSION,
          DB_NAMESPACE,
          PSMDB_PLURAL,
          database.name,
          psmdbResource
        );

        await repo.appendLog(id, `[${new Date().toISOString()}] Updated PSMDB resource with TLS enabled.`);

        // Wait for the SSL secret to be created by cert-manager
        // Percona creates secrets named: {cluster-name}-ssl and {cluster-name}-ssl-internal
        const sslSecretName = `${database.name}-ssl`;
        let attempts = 0;
        const maxAttempts = 30; // 30 * 2s = 60s max wait

        while (attempts < maxAttempts) {
          const secretData = await k8s.getSecret(DB_NAMESPACE, sslSecretName);
          if (secretData && secretData["ca.crt"]) {
            caCert = secretData["ca.crt"];
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
          attempts++;
        }

        if (!caCert) {
          throw new InternalServerError(
            `TLS certificate generation timed out. Secret ${sslSecretName} not found or missing ca.crt.`
          );
        }

        await repo.appendLog(id, `[${new Date().toISOString()}] Retrieved CA certificate from K8s secret.`);

      } catch (err: any) {
        await repo.appendLog(id, `[${new Date().toISOString()}] TLS enable failed: ${err.message}`);
        throw err;
      }
    } else {
      // Non-K8s mode: TLS configuration requires manual certificate setup
      // For now, we'll create a placeholder that indicates TLS is expected
      await repo.appendLog(
        id,
        `[${new Date().toISOString()}] K8s disabled — TLS enabled with placeholder. Provide CA certificate manually.`
      );
    }

    // Build TLS connection string
    const baseConnString = database.dns?.srvConnectionString || database.credentials.connectionString;
    if (baseConnString) {
      // Add TLS parameters to connection string
      const separator = baseConnString.includes("?") ? "&" : "?";
      tlsConnectionString = `${baseConnString}${separator}tls=true&tlsAllowInvalidCertificates=false`;
    }

    // Save TLS config to database record
    await repo.updateTLS(id, {
      enabled: true,
      caCert,
      tlsConnectionString,
      configuredAt: new Date(),
    });

    logger.log({
      level: "info",
      message: `[Database] TLS enabled for ${database.name}`,
    });

    return {
      message: "TLS enabled successfully.",
      tlsConnectionString: tlsConnectionString || undefined,
    };
  }

  /**
   * Disable TLS for a database
   */
  async function disableTLS(id: string): Promise<{ message: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!database.tls?.enabled) {
      throw new BadRequestError("TLS is not enabled for this database.");
    }

    await repo.appendLog(id, `[${new Date().toISOString()}] Disabling TLS...`);

    if (K8S_ENABLED) {
      try {
        k8s.init();

        // Update the PSMDB resource to disable TLS
        const psmdbResource = buildPSMDBResourceWithTLS(database, false);
        await k8s.updateCustomResource(
          PSMDB_GROUP,
          PSMDB_VERSION,
          DB_NAMESPACE,
          PSMDB_PLURAL,
          database.name,
          psmdbResource
        );

        await repo.appendLog(id, `[${new Date().toISOString()}] Updated PSMDB resource with TLS disabled.`);

      } catch (err: any) {
        await repo.appendLog(id, `[${new Date().toISOString()}] TLS disable failed: ${err.message}`);
        throw err;
      }
    }

    // Remove TLS config from database record
    await repo.removeTLS(id);

    logger.log({
      level: "info",
      message: `[Database] TLS disabled for ${database.name}`,
    });

    return {
      message: "TLS disabled successfully.",
    };
  }

  /**
   * Get TLS status and configuration for a database
   */
  async function getTLSStatus(id: string): Promise<{
    enabled: boolean;
    tlsConnectionString?: string;
    configuredAt?: Date;
  }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!database.tls?.enabled) {
      return {
        enabled: false,
      };
    }

    return {
      enabled: true,
      tlsConnectionString: database.tls.tlsConnectionString,
      configuredAt: database.tls.configuredAt,
    };
  }

  /**
   * Get the CA certificate for a database (for client configuration)
   */
  async function getCACertificate(id: string): Promise<{ caCert: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!database.tls?.enabled) {
      throw new BadRequestError("TLS is not enabled for this database.");
    }

    if (!database.tls.caCert) {
      // Try to fetch from K8s if available
      if (K8S_ENABLED) {
        try {
          k8s.init();
          const sslSecretName = `${database.name}-ssl`;
          const secretData = await k8s.getSecret(DB_NAMESPACE, sslSecretName);
          
          if (secretData && secretData["ca.crt"]) {
            // Update the stored CA cert
            await repo.updateTLS(id, {
              ...database.tls,
              caCert: secretData["ca.crt"],
            });
            return { caCert: secretData["ca.crt"] };
          }
        } catch (err) {
          // Fall through to error
        }
      }
      throw new BadRequestError("CA certificate not available.");
    }

    return {
      caCert: database.tls.caCert,
    };
  }

  /**
   * Build a PSMDB resource with TLS configuration
   */
  function buildPSMDBResourceWithTLS(database: TDatabase, tlsEnabled: boolean): object {
    const replicas = database.nodes.filter((n) => n.role !== "arbiter").length;
    const arbiters = database.nodes.filter((n) => n.role === "arbiter").length;

    const spec: any = {
      image: `percona/percona-server-mongodb:${database.version}`,
      imagePullPolicy: "IfNotPresent",
      replsets: [
        {
          name: database.config.replicaSetName || "rs0",
          size: replicas || 1,
          arbiter: {
            enabled: arbiters > 0,
            size: arbiters,
          },
          configuration: database.config.cacheSizeGB
            ? `storage:\n  wiredTiger:\n    engineConfig:\n      cacheSizeGB: ${database.config.cacheSizeGB}`
            : undefined,
          expose: {
            enabled: true,
            exposeType: "ClusterIP",
          },
        },
      ],
      secrets: {
        users: `${database.name}-secrets`,
      },
      users: [
        {
          name: database.credentials.adminUser,
          db: "admin",
          passwordSecretRef: {
            name: `${database.name}-secrets`,
            key: "MONGODB_DATABASE_ADMIN_PASSWORD",
          },
          roles: [
            { name: "root", db: "admin" },
          ],
        },
      ],
    };

    // Add TLS configuration if enabled
    if (tlsEnabled) {
      spec.tls = {
        mode: "requireTLS",
        // Percona auto-generates certs if cert-manager is installed
        // No need to specify certSecret or caSecret - they're auto-created
      };
    }

    return {
      apiVersion: `${PSMDB_GROUP}/${PSMDB_VERSION}`,
      kind: "PerconaServerMongoDB",
      metadata: {
        name: database.name,
        namespace: DB_NAMESPACE,
        labels: {
          "app.kubernetes.io/managed-by": "control-plane",
          "control-plane/database-type": database.type,
        },
      },
      spec,
    };
  }

  // ===========================================================================
  // Backup Management
  // ===========================================================================

  /**
   * Configure backup settings for a database.
   * Creates S3 credentials secret in K8s and updates the PSMDB resource.
   */
  async function configureBackup(
    id: string,
    config: TBackupConfigInput
  ): Promise<{ message: string; configured: boolean }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    const secretName = `cp-db-${database.name}-s3-backup`;

    // Create/update S3 credentials secret in K8s
    if (K8S_ENABLED) {
      try {
        k8s.init();

        await repo.appendLog(id, `[${new Date().toISOString()}] Configuring backup with S3 bucket: ${config.s3Bucket}`);

        // Create S3 credentials secret
        await k8s.createSecret(DB_NAMESPACE, secretName, {
          AWS_ACCESS_KEY_ID: config.accessKeyId,
          AWS_SECRET_ACCESS_KEY: config.secretAccessKey,
        });

        await repo.appendLog(id, `[${new Date().toISOString()}] S3 credentials secret created: ${secretName}`);

        // Build backup configuration for the database
        const backupConfig: TDatabaseBackup = {
          enabled: config.enabled,
          schedule: config.schedule,
          s3Bucket: config.s3Bucket,
          s3Endpoint: config.s3Endpoint,
          s3Region: config.s3Region || "us-east-1",
          credentialsSecret: secretName,
        };

        // Update database record
        await repo.updateBackupConfig(id, backupConfig);

        // Update the PSMDB custom resource with backup configuration
        const updatedDb = await repo.getById(id);
        if (updatedDb) {
          const psmdbResource = buildPSMDBResourceWithBackup(updatedDb);

          try {
            await k8s.updateCustomResource(
              PSMDB_GROUP,
              PSMDB_VERSION,
              DB_NAMESPACE,
              PSMDB_PLURAL,
              database.name,
              psmdbResource
            );
            await repo.appendLog(id, `[${new Date().toISOString()}] PSMDB backup configuration updated.`);
          } catch (err: any) {
            // If update fails, try creating (resource might not exist)
            if (err.response?.statusCode === 404) {
              await repo.appendLog(id, `[${new Date().toISOString()}] PSMDB resource not found — backup config saved but not applied to K8s.`);
            } else {
              throw err;
            }
          }
        }

        logger.log({
          level: "info",
          message: `[Database] Backup configured for ${database.name}: ${config.s3Bucket}`,
        });

        return {
          message: "Backup configuration updated.",
          configured: true,
        };
      } catch (err: any) {
        await repo.appendLog(id, `[${new Date().toISOString()}] ERROR configuring backup: ${err.message}`);
        throw new InternalServerError(`Failed to configure backup: ${err.message}`);
      }
    } else {
      // Non-K8s mode: just save config
      const backupConfig: TDatabaseBackup = {
        enabled: config.enabled,
        schedule: config.schedule,
        s3Bucket: config.s3Bucket,
        s3Endpoint: config.s3Endpoint,
        s3Region: config.s3Region || "us-east-1",
        credentialsSecret: secretName,
      };

      await repo.updateBackupConfig(id, backupConfig);
      await repo.appendLog(id, `[${new Date().toISOString()}] Backup configuration saved. K8s disabled — manual setup required.`);

      return {
        message: "Backup configuration saved. K8s disabled — manual setup required.",
        configured: true,
      };
    }
  }

  /**
   * Trigger an immediate backup for a database.
   */
  async function triggerBackup(
    id: string
  ): Promise<{ message: string; backupName?: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!database.backup?.enabled) {
      throw new BadRequestError("Backup is not configured for this database.");
    }

    if (!K8S_ENABLED) {
      await repo.appendLog(id, `[${new Date().toISOString()}] Manual backup triggered. K8s disabled — manual execution required.`);
      return {
        message: "Backup trigger recorded. K8s disabled — manual execution required.",
      };
    }

    try {
      k8s.init();

      const backupName = `${database.name}-manual-${Date.now()}`;
      await repo.appendLog(id, `[${new Date().toISOString()}] Triggering manual backup: ${backupName}`);

      // Create a PerconaServerMongoDBBackup custom resource
      const backupResource = {
        apiVersion: `${PSMDB_GROUP}/${PSMDB_VERSION}`,
        kind: "PerconaServerMongoDBBackup",
        metadata: {
          name: backupName,
          namespace: DB_NAMESPACE,
          labels: {
            "app.kubernetes.io/managed-by": "control-plane",
            "control-plane/database": database.name,
          },
        },
        spec: {
          clusterName: database.name,
          storageName: "s3-backup",
          type: "logical",
        },
      };

      await k8s.createCustomResource(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        "perconaservermongodbbackups",
        backupResource
      );

      await repo.updateBackupTime(id);
      await repo.appendLog(id, `[${new Date().toISOString()}] Backup triggered: ${backupName}`);

      logger.log({
        level: "info",
        message: `[Database] Manual backup triggered for ${database.name}: ${backupName}`,
      });

      return {
        message: "Backup triggered successfully.",
        backupName,
      };
    } catch (err: any) {
      await repo.appendLog(id, `[${new Date().toISOString()}] ERROR triggering backup: ${err.message}`);
      throw new InternalServerError(`Failed to trigger backup: ${err.message}`);
    }
  }

  /**
   * List available backups for a database.
   */
  async function listBackups(id: string): Promise<{ backups: TBackupInfo[] }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!K8S_ENABLED) {
      return {
        backups: [],
      };
    }

    try {
      k8s.init();

      // List PerconaServerMongoDBBackup resources for this database
      const backupList = await k8s.listCustomResources(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        "perconaservermongodbbackups"
      );

      const backups: TBackupInfo[] = backupList
        .filter((item: any) => item.spec?.clusterName === database.name)
        .map((item: any) => ({
          name: item.metadata?.name || "unknown",
          status: item.status?.state || "unknown",
          type: item.spec?.type || "logical",
          storageName: item.spec?.storageName || "unknown",
          completed: item.status?.completed ? new Date(item.status.completed) : undefined,
          pbmName: item.status?.pbmName,
          size: item.status?.destination?.size,
        }));

      return { backups };
    } catch (err: any) {
      logger.log({
        level: "error",
        message: `[Database] Failed to list backups for ${database.name}: ${err.message}`,
      });
      return { backups: [] };
    }
  }

  /**
   * Restore a database from a backup.
   */
  async function restoreBackup(
    id: string,
    backupName: string
  ): Promise<{ message: string; restoreName?: string }> {
    const database = await repo.getById(id);
    if (!database) {
      throw new NotFoundError("Database not found.");
    }

    if (!K8S_ENABLED) {
      throw new BadRequestError("Restore requires K8s integration to be enabled.");
    }

    try {
      k8s.init();

      const restoreName = `${database.name}-restore-${Date.now()}`;
      await repo.appendLog(id, `[${new Date().toISOString()}] Initiating restore from backup: ${backupName}`);

      // Create a PerconaServerMongoDBRestore custom resource
      const restoreResource = {
        apiVersion: `${PSMDB_GROUP}/${PSMDB_VERSION}`,
        kind: "PerconaServerMongoDBRestore",
        metadata: {
          name: restoreName,
          namespace: DB_NAMESPACE,
          labels: {
            "app.kubernetes.io/managed-by": "control-plane",
            "control-plane/database": database.name,
          },
        },
        spec: {
          clusterName: database.name,
          backupName: backupName,
        },
      };

      await k8s.createCustomResource(
        PSMDB_GROUP,
        PSMDB_VERSION,
        DB_NAMESPACE,
        "perconaservermongodbrestores",
        restoreResource
      );

      await repo.appendLog(id, `[${new Date().toISOString()}] Restore initiated: ${restoreName}`);

      logger.log({
        level: "info",
        message: `[Database] Restore initiated for ${database.name} from backup ${backupName}`,
      });

      return {
        message: "Restore initiated successfully. Monitor logs for progress.",
        restoreName,
      };
    } catch (err: any) {
      await repo.appendLog(id, `[${new Date().toISOString()}] ERROR initiating restore: ${err.message}`);
      throw new InternalServerError(`Failed to initiate restore: ${err.message}`);
    }
  }

  /**
   * Build a PerconaServerMongoDB custom resource manifest with backup configuration.
   */
  function buildPSMDBResourceWithBackup(database: TDatabase): object {
    const baseResource = buildPSMDBResource(database);

    // If backup is not configured, return base resource
    if (!database.backup?.enabled || !database.backup?.s3Bucket) {
      return baseResource;
    }

    const backup = database.backup;

    // Build S3 storage configuration
    const s3Config: Record<string, any> = {
      bucket: backup.s3Bucket,
      credentialsSecret: backup.credentialsSecret || `cp-db-${database.name}-s3-backup`,
    };

    if (backup.s3Region) {
      s3Config.region = backup.s3Region;
    }

    if (backup.s3Endpoint) {
      s3Config.endpointUrl = backup.s3Endpoint;
    }

    // Add backup configuration to the PSMDB spec
    const spec = (baseResource as any).spec;
    spec.backup = {
      enabled: true,
      storages: {
        "s3-backup": {
          type: "s3",
          s3: s3Config,
        },
      },
      tasks: [
        {
          name: "scheduled-backup",
          enabled: backup.enabled,
          schedule: backup.schedule,
          storageName: "s3-backup",
          compressionType: "gzip",
        },
      ],
    };

    return baseResource;
  }

  return {
    create,
    remove,
    reprovision,
    getHealth,
    configureDNS,
    removeDNS,
    addNode,
    removeNode,
    getLogs,
    // TLS management
    enableTLS,
    disableTLS,
    getTLSStatus,
    getCACertificate,
    // Backup management
    configureBackup,
    triggerBackup,
    listBackups,
    restoreBackup,
  };
}
