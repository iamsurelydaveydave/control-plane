import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { useDatabaseRepo } from "./database.repository";
import { schemaDatabaseCreate, schemaDatabaseUpdate, databaseNodeRoles } from "./database.model";
import { BadRequestError, NotFoundError, InternalServerError, generateSslipHost, logBroker } from "../../utils";
import { getMongoDBProvisioner, getProvisionerType } from "../../services/mongodb.provisioner.factory";
import { useServerRepo } from "../server";

export function useDatabaseController() {
  const repo = useDatabaseRepo();
  const serverRepo = useServerRepo();
  const mongoProvisioner = getMongoDBProvisioner();

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaDatabaseCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Start provisioning in background if auto_provision is enabled
      const autoProvision = req.query.auto_provision !== "false";

      // Verify all target servers are ready BEFORE creating the record
      if (autoProvision && value.type === "mongodb") {
        for (const node of value.nodes ?? []) {
          const server = await serverRepo.getById(node.serverId);
          if (!server) {
            next(new NotFoundError(`Server ${node.serverId} not found`));
            return;
          }
          if (server.status !== "online") {
            next(new BadRequestError(`Server "${server.name}" is not ready (status: ${server.status}). Complete server setup first.`));
            return;
          }
          if (!server.dockerInstalled) {
            next(new BadRequestError(`Server "${server.name}" does not have Docker installed. Complete server setup first.`));
            return;
          }
        }
      }

      const id = await repo.add(value);

      if (autoProvision && value.type === "mongodb") {
        const userId = req.cookies?.user;

        // Don't await - let it run in background
        const dbId = id.toString();
        mongoProvisioner
          .provision({
            databaseId: dbId,
            triggeredBy: userId,
            onLog: (line) => logBroker.addLine(dbId, line),
          })
          .then((result) => logBroker.complete(dbId, result.success ? "success" : "failed"))
          .catch((err) => {
            logBroker.addLine(dbId, `[ERROR] ${err.message}`);
            logBroker.complete(dbId, "failed");
          });

        res.status(202).json({
          message: "Database created, provisioning started",
          databaseId: id,
          status: "provisioning",
        });
      } else {
        res.status(201).json({
          message: "Database created",
          databaseId: id,
          status: "pending",
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      // Build per-node sslip.io fallback hosts when DB DNS is not configured.
      // This gives every node a stable human-readable hostname even without DNS.
      const port = (database.config?.port as number | undefined) || 27017;
      let nodesWithSslip = database.nodes;

      if (!database.dns?.enabled) {
        const safeName = database.name.replace(/[^a-z0-9-]/g, "-").toLowerCase();
        nodesWithSslip = await Promise.all(
          database.nodes.map(async (node, i) => {
            const server = await serverRepo.getById(node.serverId).catch(() => null);
            const sslipHost = server?.host
              ? generateSslipHost(`node${i + 1}-${safeName}`, server.host)
              : undefined;
            const sslipConnectionHost = sslipHost ? `${sslipHost}:${port}` : undefined;
            return { ...node, sslipHost, sslipConnectionHost };
          })
        );
      }

      // Mask sensitive credentials in response
      const safeDatabase = {
        ...database,
        nodes: nodesWithSslip,
        credentials: {
          adminUser: database.credentials.adminUser,
          hasPassword: !!database.credentials.adminPassword,
          hasConnectionString: !!database.credentials.connectionString,
        },
      };

      res.json({ database: safeDatabase });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, type, status } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        type: type as string,
        status: status as any,
      });

      res.json(data);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id
   * Full deletion - removes everything:
   * - Stops and removes MongoDB containers
   * - Removes config files, keyfiles, TLS certificates
   * - Optionally removes data directory
   * - Removes DNS records from Cloudflare
   * - Deletes the database record
   *
   * This operation is ASYNC - returns immediately with status "deleting"
   * and the deletion happens in the background.
   *
   * Query params:
   *   - keep_data=true: Preserve the data directory on servers
   *   - force=true: Delete record even if container removal fails (for orphaned records)
   */
  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const keepData = req.query.keep_data === "true";
      const force = req.query.force === "true";

      const database = await repo.getById(id);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      // If already deleting, just return current status
      if (database.status === "deleting") {
        res.status(202).json({
          message: "Database deletion already in progress",
          databaseId: id,
          status: "deleting",
        });
        return;
      }

      // Set status to deleting immediately
      await repo.updateStatus(id, "deleting");

      // Return immediately - deletion happens in background
      res.status(202).json({
        message: "Database deletion started",
        databaseId: id,
        status: "deleting",
      });

      // Run deletion in background (don't await)
      runDeletionInBackground(id, database, keepData, force);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Background deletion handler - runs after response is sent
   */
  async function runDeletionInBackground(
    id: string,
    database: any,
    keepData: boolean,
    force: boolean
  ) {
    try {
      let removedContainers = false;
      let removedData = false;
      let removedDnsRecords = 0;
      let removedTls = false;

      // For MongoDB databases that have been provisioned, clean up the deployment
      if (database.type === "mongodb" && database.status !== "provisioning") {
        logBroker.addLine(id, "[delete] Starting full database deletion...");
        logBroker.addLine(id, `[delete] Keep data: ${keepData}`);

        try {
          // Remove MongoDB containers, configs, TLS, DNS from all nodes
          const result = await mongoProvisioner.remove(id, keepData, (line) =>
            logBroker.addLine(id, line)
          );

          if (result.success) {
            removedContainers = true;
            removedData = !keepData;
            removedDnsRecords = database.dns?.records?.length || 0;
            removedTls = !!database.tls?.enabled;
          } else if (!force) {
            logBroker.addLine(id, `[delete] Removal failed: ${result.error}`);
            logBroker.complete(id, "failed");
            // Update status to failed instead of deleting the record
            await repo.updateStatus(id, "failed");
            return;
          } else {
            logBroker.addLine(id, "[delete] Removal failed but continuing with force=true");
          }
        } catch (removeErr: any) {
          if (!force) {
            logBroker.addLine(id, `[delete] Error: ${removeErr.message}`);
            logBroker.complete(id, "failed");
            await repo.updateStatus(id, "failed");
            return;
          }
          logBroker.addLine(id, `[delete] Error (ignored with force=true): ${removeErr.message}`);
        }

        logBroker.addLine(id, "[delete] Deleting database record...");
        logBroker.complete(id, "success");
      } else if (database.type === "mongodb" && database.status === "provisioning") {
        // Database was created but provisioning may have partially completed
        // Try to clean up DNS records if any were created
        logBroker.addLine(id, "[delete] Database in provisioning state, cleaning up any partial resources...");

        if (database.dns?.records?.length) {
          try {
            const { useDNSService } = await import("../../services/dns.service");
            const dns = useDNSService();
            await dns.teardown(database.dns.records);
            removedDnsRecords = database.dns.records.length;
            logBroker.addLine(id, `[delete] Removed ${removedDnsRecords} DNS records`);
          } catch (dnsErr: any) {
            logBroker.addLine(id, `[delete] DNS cleanup failed (non-fatal): ${dnsErr.message}`);
          }
        }

        logBroker.addLine(id, "[delete] Deleting database record...");
        logBroker.complete(id, "success");
      }

      // Delete the database record
      await repo.deleteById(id);
    } catch (error: any) {
      console.error(`[database] Background deletion failed for ${id}:`, error.message);
      logBroker.addLine(id, `[delete] Background deletion error: ${error.message}`);
      logBroker.complete(id, "failed");
      // Try to update status to failed
      try {
        await repo.updateStatus(id, "failed");
      } catch {
        // Record may already be deleted
      }
    }
  }

  async function provision(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;

      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("Only MongoDB provisioning is supported"));
        return;
      }

      // Verify all node servers are ready
      for (const node of database.nodes) {
        const server = await serverRepo.getById(node.serverId.toString());
        if (server && server.status !== "online") {
          next(new BadRequestError(`Server "${server.name}" is not online (status: ${server.status}). Check server status before provisioning.`));
          return;
        }
        if (server && !server.dockerInstalled) {
          next(new BadRequestError(`Server "${server.name}" does not have Docker installed. Complete server setup first.`));
          return;
        }
      }

      // Start provisioning
      logBroker.addLine(id, "[provision] Starting provisioning...");
      const result = await mongoProvisioner.provision({
        databaseId: id,
        triggeredBy: userId,
        onLog: (line) => logBroker.addLine(id, line),
      });
      logBroker.complete(id, result.success ? "success" : "failed");

      if (result.success) {
        res.json({
          message: "Database provisioned successfully",
          connectionString: result.connectionString,
        });
      } else {
        res.status(500).json({
          message: "Database provisioning failed",
          error: result.error,
          logs: result.logs,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async function reprovision(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;

      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("Only MongoDB provisioning is supported"));
        return;
      }

      // Verify all node servers are ready
      for (const node of database.nodes) {
        const server = await serverRepo.getById(node.serverId.toString());
        if (server && server.status !== "online") {
          next(new BadRequestError(`Server "${server.name}" is not online (status: ${server.status}). Check server status before provisioning.`));
          return;
        }
        if (server && !server.dockerInstalled) {
          next(new BadRequestError(`Server "${server.name}" does not have Docker installed. Complete server setup first.`));
          return;
        }
      }

      // Update status to provisioning
      await repo.updateStatus(id, "provisioning");

      // Start reprovisioning in background
      mongoProvisioner
        .provision({
          databaseId: id,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(id, line),
        })
        .then((result) => logBroker.complete(id, result.success ? "success" : "failed"))
        .catch((err) => {
          logBroker.addLine(id, `[ERROR] ${err.message}`);
          logBroker.complete(id, "failed");
        });

      res.json({ message: "Database reprovision initiated" });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases/:id/remove
   * Soft remove - stops containers but keeps the database record.
   * Use DELETE /databases/:id for full deletion.
   * 
   * Query params:
   *   - keep_data=true: Preserve data directory (default: false = remove everything)
   *   - delete_record=true: Also delete the database record
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const keepData = req.query.keep_data === "true";

      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        // For non-MongoDB, just delete the record
        await repo.deleteById(id);
        res.json({ message: "Database deleted" });
        return;
      }

      // Remove MongoDB deployment
      const result = await mongoProvisioner.remove(id, keepData, (line) => logBroker.addLine(id, line));

      if (result.success) {
        // Optionally delete the record
        if (req.query.delete_record === "true") {
          await repo.deleteById(id);
          res.json({ message: "Database removed and record deleted" });
        } else {
          res.json({ message: "Database removed (record retained)" });
        }
      } else {
        res.status(500).json({
          message: "Database removal failed",
          error: result.error,
          logs: result.logs,
        });
      }
    } catch (error) {
      next(error);
    }
  }

  async function backup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;
      const database = await repo.getById(id);

      if (!database) { next(new NotFoundError("Database not found")); return; }
      if (database.type !== "mongodb") { next(new BadRequestError("Backup only supported for MongoDB")); return; }

      const result = await mongoProvisioner.backup({
        databaseId: id,
        triggeredBy: userId,
      });

      if (result.success) {
        res.json({ message: "Backup completed", s3Key: result.s3Key });
      } else {
        next(new InternalServerError(result.error || "Backup failed"));
      }
    } catch (error) {
      next(error);
    }
  }

  async function restore(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;
      const { s3Key } = req.body;

      if (!s3Key) { next(new BadRequestError("s3Key is required")); return; }

      const database = await repo.getById(id);
      if (!database) { next(new NotFoundError("Database not found")); return; }
      if (database.type !== "mongodb") { next(new BadRequestError("Restore only supported for MongoDB")); return; }
      if (database.status !== "running") { next(new BadRequestError("Database must be running to restore")); return; }

      const result = await mongoProvisioner.restore({
        databaseId: id,
        s3Key,
        triggeredBy: userId,
      });

      if (result.success) {
        res.json({ message: "Restore completed" });
      } else {
        next(new InternalServerError(result.error || "Restore failed"));
      }
    } catch (error) {
      next(error);
    }
  }

  async function getBackupRecords(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);
      if (!database) { next(new NotFoundError("Database not found")); return; }
      const records = await repo.getBackupRecords(id);
      res.json({ records });
    } catch (error) {
      next(error);
    }
  }

  async function getCredentials(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      if (database.status !== "running") {
        next(new BadRequestError("Database is not running"));
        return;
      }

      res.json({
        credentials: {
          adminUser: database.credentials.adminUser,
          adminPassword: database.credentials.adminPassword,
          connectionString: database.credentials.connectionString,
          // Include SRV connection string when DNS is configured
          srvConnectionString: database.dns?.enabled
            ? database.dns.srvConnectionString
            : undefined,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases/:id/dns
   * Trigger DNS record creation (or re-creation) for a running replica set.
   * Requires DNS credentials to be saved in settings first.
   */
  async function configureDNS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);
      if (!database) { next(new NotFoundError("Database not found")); return; }

      const result = await mongoProvisioner.configureDNS(id);

      if (!result) {
        next(new BadRequestError(
          "DNS provider not configured. Save Cloudflare credentials via PUT /api/settings/dns first."
        ));
        return;
      }

      res.json({
        message: "DNS records created",
        clusterHost: result.clusterHost,
        nodeHosts: result.nodeHosts,
        srvConnectionString: maskCredentials(result.srvConnectionString),
        recordCount: result.records.length,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id/dns
   * Remove DNS records and clear the dns field on the database.
   */
  async function removeDNS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);
      if (!database) { next(new NotFoundError("Database not found")); return; }

      if (!database.dns?.records?.length) {
        res.json({ message: "No DNS records to remove" });
        return;
      }

      const { useDNSService } = await import("../../services/dns.service");
      const dns = useDNSService();
      await dns.teardown(database.dns.records);
      await repo.updateDNS(id, null);

      res.json({ message: "DNS records removed", removed: database.dns.records.length });
    } catch (error) {
      next(error);
    }
  }

  async function getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      // Get recent deployments/logs
      const { useDeploymentRepo } = await import("../deployment");
      const deploymentRepo = useDeploymentRepo();
      const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 10;
      const deployments = await deploymentRepo.getByAppId(id, { page: 1, limit });

      res.json({
        deployments: deployments.items,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add a node to an existing database
   * Body: { serverId: string, role: 'secondary' | 'arbiter' }
   */
  async function addNode(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const { serverId, role } = req.body;

      // Validate request body
      if (!serverId) {
        next(new BadRequestError("serverId is required"));
        return;
      }

      if (!role || !['secondary', 'arbiter'].includes(role)) {
        next(new BadRequestError("role must be 'secondary' or 'arbiter'"));
        return;
      }

      // Get database
      const database = await repo.getById(databaseId);
      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("Adding nodes is only supported for MongoDB"));
        return;
      }

      // Validate server exists
      const server = await serverRepo.getById(serverId);
      if (!server) {
        next(new NotFoundError(`Server not found: ${serverId}`));
        return;
      }

      // Check server is not already in this database
      const serverAlreadyInDb = database.nodes.some(
        (n) => n.serverId.toString() === serverId.toString()
      );
      if (serverAlreadyInDb) {
        next(new BadRequestError("Server is already part of this database"));
        return;
      }

      // Check server is online
      if (server.status !== "online") {
        next(new BadRequestError(`Server is not online (status: ${server.status})`));
        return;
      }

      if (!server.dockerInstalled) {
        next(new BadRequestError(`Server "${server.name}" does not have Docker installed. Complete server setup first.`));
        return;
      }

      const userId = req.cookies?.user;

      // Start provisioning in background, return 202
      mongoProvisioner
        .addNode({
          databaseId,
          serverId,
          role,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(databaseId, line),
        })
        .then((result) => logBroker.complete(databaseId, result.success ? "success" : "failed"))
        .catch((err) => {
          logBroker.addLine(databaseId, `[ERROR] ${err.message}`);
          logBroker.complete(databaseId, "failed");
        });

      res.status(202).json({
        message: "Node addition started",
        databaseId,
        serverId,
        role,
        status: "provisioning",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove a node from an existing database
   * Cannot remove primary or last node
   */
  async function removeNode(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const serverId = req.params.serverId as string;

      // Get database
      const database = await repo.getById(databaseId);
      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("Removing nodes is only supported for MongoDB"));
        return;
      }

      // Find the node
      const node = database.nodes.find(
        (n) => n.serverId.toString() === serverId.toString()
      );

      if (!node) {
        next(new NotFoundError("Node not found in this database"));
        return;
      }

      // Cannot remove primary
      if (node.role === "primary") {
        next(new BadRequestError("Cannot remove the primary node. Step down the primary first."));
        return;
      }

      // Cannot remove standalone
      if (node.role === "standalone") {
        next(new BadRequestError("Cannot remove a standalone node. Delete the database instead."));
        return;
      }

      // Cannot remove the last node
      if (database.nodes.length <= 1) {
        next(new BadRequestError("Cannot remove the last node. Delete the database instead."));
        return;
      }

      // Cannot remove if only one node would remain (replica set needs at least 2 voting members)
      // Note: This is simplified - actual MongoDB rules are more complex
      const votingMembers = database.nodes.filter((n) => n.role !== "arbiter");
      if (votingMembers.length <= 2 && node.role !== "arbiter") {
        next(new BadRequestError("Cannot remove this node - replica set would have insufficient members"));
        return;
      }

      const userId = req.cookies?.user;

      // Start removal in background, return 202
      mongoProvisioner
        .removeNode({
          databaseId,
          serverId,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(databaseId, line),
        })
        .then((result) => logBroker.complete(databaseId, result.success ? "success" : "failed"))
        .catch((err) => {
          logBroker.addLine(databaseId, `[ERROR] ${err.message}`);
          logBroker.complete(databaseId, "failed");
        });

      res.status(202).json({
        message: "Node removal started",
        databaseId,
        serverId,
        status: "removing",
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get health status of a database
   */
  async function getHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;

      // Get database
      const database = await repo.getById(databaseId);
      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("Health check is only supported for MongoDB"));
        return;
      }

      if (database.status !== "running") {
        res.json({
          status: "not_running",
          databaseStatus: database.status,
          members: [],
        });
        return;
      }

      const health = await mongoProvisioner.getHealth(databaseId);

      res.json(health);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases/:id/tls
   * Configure TLS for a MongoDB replica set.
   * Returns immediately with status 202 and streams logs via SSE at GET /:id/tls/stream
   */
  async function configureTLS(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const database = await repo.getById(databaseId);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (database.type !== "mongodb") {
        next(new BadRequestError("TLS configuration is only supported for MongoDB"));
        return;
      }

      if (database.status !== "running") {
        next(new BadRequestError("Database must be running to configure TLS"));
        return;
      }

      if (database.nodes.length < 2) {
        next(new BadRequestError("TLS requires a replica set (2+ nodes)"));
        return;
      }

      if (database.tls?.enabled) {
        next(new BadRequestError("TLS is already configured for this database"));
        return;
      }

      const userId = req.cookies?.user || "system";

      // Start TLS configuration asynchronously using the database ID as the log key
      // (same pattern as provisioning)
      logBroker.addLine(databaseId, "[TLS] Starting TLS configuration...");

      mongoProvisioner
        .configureTLS({
          databaseId,
          triggeredBy: userId,
          onLog: (line) => logBroker.addLine(databaseId, line),
        })
        .then((result) => {
          logBroker.complete(databaseId, result.success ? "success" : "failed");
        })
        .catch((err) => {
          logBroker.addLine(databaseId, `[TLS ERROR] ${err.message}`);
          logBroker.complete(databaseId, "failed");
        });

      res.status(202).json({
        message: "TLS configuration started",
        databaseId,
        streamUrl: `/api/databases/${databaseId}/provision/stream`,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/tls
   * Get TLS configuration status and CA certificate for client distribution.
   */
  async function getTLSStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const database = await repo.getById(databaseId);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (!database.tls?.enabled) {
        res.json({
          enabled: false,
          message: "TLS is not configured for this database",
        });
        return;
      }

      res.json({
        enabled: true,
        configuredAt: database.tls.configuredAt,
        tlsConnectionString: maskCredentials(database.tls.tlsConnectionString),
        hasCaCert: !!database.tls.caCert,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/tls/ca
   * Download the CA certificate for client connections.
   */
  async function getTLSCertificate(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const database = await repo.getById(databaseId);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (!database.tls?.enabled || !database.tls.caCert) {
        next(new NotFoundError("TLS CA certificate not available"));
        return;
      }

      const safeName = database.name.replace(/[^a-zA-Z0-9_-]/g, "_");

      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="${safeName}-ca.crt"`);
      res.send(database.tls.caCert);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id/tls
   * Disable TLS on a MongoDB replica set (reconfigure without TLS).
   * Note: This is a destructive operation that will restart all nodes.
   */
  async function disableTLS(req: Request, res: Response, next: NextFunction) {
    try {
      const databaseId = req.params.id as string;
      const database = await repo.getById(databaseId);

      if (!database) {
        next(new NotFoundError("Database not found"));
        return;
      }

      if (!database.tls?.enabled) {
        res.json({ message: "TLS is not enabled for this database" });
        return;
      }

      // For now, just clear the TLS config from the database record.
      // A full implementation would also reconfigure the MongoDB containers.
      // TODO: Implement Ansible playbook to disable TLS on running cluster

      await repo.updateTLS(databaseId, null);
      await repo.updateById(databaseId, {
        config: {
          ...database.config,
          tlsEnabled: false,
          tlsDir: undefined,
        },
      });

      res.json({
        message: "TLS configuration removed from database record. Note: MongoDB containers may still have TLS enabled until reprovisioned.",
        warning: "A full reprovision is recommended to disable TLS on the running cluster.",
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    add,
    getById,
    getAll,
    deleteById,
    provision,
    reprovision,
    remove,
    backup,
    restore,
    getBackupRecords,
    getCredentials,
    getLogs,
    addNode,
    removeNode,
    getHealth,
    configureDNS,
    removeDNS,
    configureTLS,
    getTLSStatus,
    getTLSCertificate,
    disableTLS,
  };
}

/** Mask the password inside a connection string for safe display. */
function maskCredentials(s: string): string {
  return s.replace(/:[^:@]+@/, ":****@");
}
