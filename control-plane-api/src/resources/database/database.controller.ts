import { Request, Response, NextFunction } from "express";
import { useDatabaseRepo } from "./database.repository";
import { useDatabaseService } from "./database.service";
import {
  schemaDatabaseCreate,
  schemaDatabaseUpdate,
  schemaAddNode,
  schemaBackupConfig,
  schemaRestoreBackup,
  TDatabase,
} from "./database.model";
import { BadRequestError, NotFoundError } from "../../utils/error";

export function useDatabaseController() {
  const repo = useDatabaseRepo();
  const service = useDatabaseService();

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * GET /databases
   * List all databases with pagination and filtering
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, type, status, search } = req.query;

      const result = await repo.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        type: type as any,
        status: status as any,
        search: search as string,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases
   * Create a new database
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaDatabaseCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.create(value);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id
   * Get database by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);

      if (!database) {
        next(new NotFoundError("Database not found."));
        return;
      }

      // Mask sensitive credentials
      const safeDatabase: Partial<TDatabase> = {
        ...database,
        credentials: {
          ...database.credentials,
          adminPassword: "****",
        },
      };

      res.json({ database: safeDatabase });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /databases/:id
   * Update database
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaDatabaseUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const database = await repo.getById(id);
      if (!database) {
        next(new NotFoundError("Database not found."));
        return;
      }

      await repo.updateById(id, value);

      res.json({ message: "Database updated." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id
   * Delete database and clean up resources
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const force = req.query.force === "true";

      const result = await service.remove(id, { force });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * POST /databases/:id/reprovision
   * Re-run provisioning for a database
   */
  async function reprovision(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.reprovision(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/credentials
   * Get database credentials (admin user, password, connection strings)
   */
  async function getCredentials(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const database = await repo.getById(id);

      if (!database) {
        next(new NotFoundError("Database not found."));
        return;
      }

      res.json({
        adminUser: database.credentials.adminUser,
        adminPassword: database.credentials.adminPassword,
        connectionString: database.credentials.connectionString,
        srvConnectionString: database.credentials.srvConnectionString || database.dns?.srvConnectionString,
        // Include TLS connection string if TLS is enabled
        tlsConnectionString: database.tls?.enabled ? database.tls.tlsConnectionString : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/health
   * Get replica set health status
   */
  async function getHealth(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.getHealth(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/logs
   * Get deployment logs
   */
  async function getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.getLogs(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Node Management
  // ---------------------------------------------------------------------------

  /**
   * POST /databases/:id/nodes
   * Add a node to the database
   */
  async function addNode(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaAddNode.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.addNode(id, value);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id/nodes/:serverId
   * Remove a node from the database
   */
  async function removeNode(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const serverId = req.params.serverId as string;

      const result = await service.removeNode(id, serverId);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // DNS Management
  // ---------------------------------------------------------------------------

  /**
   * POST /databases/:id/dns
   * Configure DNS for the database
   */
  async function configureDNS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.configureDNS(id);

      if (!result) {
        res.json({
          message: "DNS configuration not available. Check DNS settings.",
          configured: false,
        });
        return;
      }

      res.status(201).json({
        message: "DNS configured successfully.",
        configured: true,
        clusterHost: result.clusterHost,
        nodeHosts: result.nodeHosts,
        srvConnectionString: result.srvConnectionString,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id/dns
   * Remove DNS configuration
   */
  async function removeDNS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.removeDNS(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // TLS Management
  // ---------------------------------------------------------------------------

  /**
   * POST /databases/:id/tls
   * Enable TLS for a database
   */
  async function enableTLS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.enableTLS(id);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /databases/:id/tls
   * Disable TLS for a database
   */
  async function disableTLS(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.disableTLS(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/tls
   * Get TLS status for a database
   */
  async function getTLSStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.getTLSStatus(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/tls/ca
   * Download CA certificate for a database
   */
  async function getCACertificate(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.getCACertificate(id);

      // Set headers for certificate download
      res.setHeader("Content-Type", "application/x-pem-file");
      res.setHeader("Content-Disposition", `attachment; filename="ca-${id}.crt"`);
      res.send(result.caCert);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Backup Management
  // ---------------------------------------------------------------------------

  /**
   * POST /databases/:id/backup/config
   * Configure backup settings
   */
  async function configureBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaBackupConfig.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.configureBackup(id, value);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases/:id/backup
   * Trigger manual backup
   */
  async function triggerBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.triggerBackup(id);

      res.status(201).json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /databases/:id/backups
   * List available backups
   */
  async function listBackups(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.listBackups(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /databases/:id/backup/restore
   * Restore from backup
   */
  async function restoreBackup(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaRestoreBackup.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.restoreBackup(id, value.backupName);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    create,
    getById,
    update,
    remove,
    reprovision,
    getCredentials,
    getHealth,
    getLogs,
    addNode,
    removeNode,
    configureDNS,
    removeDNS,
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
