import { Request, Response, NextFunction } from "express";
import { useDatabaseRepo } from "./database.repository";
import { schemaDatabaseCreate, schemaDatabaseUpdate } from "./database.model";
import { BadRequestError } from "../../utils";
import { useMongoDBProvisioner } from "../../services";

export function useDatabaseController() {
  const repo = useDatabaseRepo();
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
  };
}
