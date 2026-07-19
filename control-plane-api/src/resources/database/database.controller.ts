import { Request, Response, NextFunction } from "express";
import { ObjectId } from "mongodb";
import { useDatabaseRepo } from "./database.repository";
import { schemaDatabaseCreate, schemaDatabaseUpdate, databaseNodeRoles } from "./database.model";
import { BadRequestError, NotFoundError } from "../../utils";
import { useMongoDBProvisioner } from "../../services";
import { useServerRepo } from "../server";

export function useDatabaseController() {
  const repo = useDatabaseRepo();
  const serverRepo = useServerRepo();
  const mongoProvisioner = useMongoDBProvisioner();

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaDatabaseCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const id = await repo.add(value);

      // Start provisioning in background if auto_provision is enabled
      const autoProvision = req.query.auto_provision !== "false";
      
      if (autoProvision && value.type === "mongodb") {
        const userId = req.cookies?.user;
        
        // Don't await - let it run in background
        mongoProvisioner
          .provision({
            databaseId: id.toString(),
            triggeredBy: userId,
            onLog: (line) => {
              // In production, you'd stream this via SSE or WebSocket
              console.log(`[Provision ${id}] ${line}`);
            },
          })
          .catch((err) => {
            console.error(`Provisioning failed for ${id}:`, err);
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

      // Mask sensitive credentials in response
      const safeDatabase = {
        ...database,
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

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await repo.deleteById(id);
      res.json({ message: "Database deleted" });
    } catch (error) {
      next(error);
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

      // Start provisioning
      const result = await mongoProvisioner.provision({
        databaseId: id,
        triggeredBy: userId,
        onLog: (line) => {
          console.log(`[Provision ${id}] ${line}`);
        },
      });

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

      // Update status to provisioning
      await repo.updateStatus(id, "provisioning");

      // Start reprovisioning in background
      mongoProvisioner
        .provision({
          databaseId: id,
          triggeredBy: userId,
          onLog: (line) => {
            console.log(`[Reprovision ${id}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Reprovisioning failed for ${id}:`, err);
        });

      res.json({ message: "Database reprovision initiated" });
    } catch (error) {
      next(error);
    }
  }

  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const removeData = req.query.remove_data === "true";

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
      const result = await mongoProvisioner.remove(id, removeData, (line) => {
        console.log(`[Remove ${id}] ${line}`);
      });

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
      const database = await repo.getById(id);

      if (!database) {
        next(new BadRequestError("Database not found"));
        return;
      }

      if (!database.backup?.enabled) {
        next(new BadRequestError("Backups not enabled for this database"));
        return;
      }

      // TODO: Implement actual backup trigger logic
      await repo.updateBackupTime(id);

      res.json({ message: "Backup initiated" });
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
        },
      });
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
      const deployments = await deploymentRepo.getByAppId(id, { page: 1, limit: 5 });

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

      const userId = req.cookies?.user;

      // Start provisioning in background, return 202
      mongoProvisioner
        .addNode({
          databaseId,
          serverId,
          role,
          triggeredBy: userId,
          onLog: (line) => {
            console.log(`[AddNode ${databaseId}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Add node failed for ${databaseId}:`, err);
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
          onLog: (line) => {
            console.log(`[RemoveNode ${databaseId}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Remove node failed for ${databaseId}:`, err);
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

  return {
    add,
    getById,
    getAll,
    deleteById,
    provision,
    reprovision,
    remove,
    backup,
    getCredentials,
    getLogs,
    addNode,
    removeNode,
    getHealth,
  };
}
