import { Request, Response, NextFunction } from "express";
import { useAddonRepo } from "./addon.repository";
import { useAddonService } from "./addon.service";
import {
  schemaAddonCreate,
  schemaAddonUpdate,
  TAddon,
} from "./addon.model";
import { BadRequestError, NotFoundError } from "../../utils/error";

export function useAddonController() {
  const repo = useAddonRepo();
  const service = useAddonService();

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  /**
   * GET /addons
   * List all addons with pagination and filtering
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const { page, limit, type, status, namespace, organizationId, search } = req.query;

      const result = await repo.getAll({
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 20,
        type: type as any,
        status: status as any,
        namespace: namespace as string,
        organizationId: organizationId as string,
        search: search as string,
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /addons/catalog
   * Get available addon types and their info
   */
  async function getCatalog(_req: Request, res: Response, next: NextFunction) {
    try {
      const catalog = service.getCatalog();
      res.json({ catalog });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons
   * Create a new addon (deploys Helm chart)
   */
  async function create(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaAddonCreate.validate(req.body);
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
   * GET /addons/:id
   * Get addon by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const addon = await repo.getById(id);

      if (!addon) {
        next(new NotFoundError("Addon not found."));
        return;
      }

      // Mask sensitive connection info in response
      const safeAddon: Partial<TAddon> = {
        ...addon,
        connectionInfo: addon.connectionInfo
          ? {
              ...addon.connectionInfo,
              password: addon.connectionInfo.password ? "****" : undefined,
            }
          : undefined,
      };

      res.json({ addon: safeAddon });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /addons/:id
   * Update addon (triggers Helm upgrade if values/version changed)
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const { error, value } = schemaAddonUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const result = await service.update(id, value);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /addons/:id
   * Delete addon (uninstalls Helm release)
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.remove(id);

      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------

  /**
   * GET /addons/:id/connection
   * Get connection info (sensitive — returns actual credentials)
   */
  async function getConnection(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const connectionInfo = await service.getConnectionInfo(id);

      if (!connectionInfo) {
        res.json({
          message: "Connection info not available. Addon may still be deploying.",
          connectionInfo: null,
        });
        return;
      }

      // Get addon to include type-specific info
      const addon = await repo.getById(id);
      
      res.json({
        connectionInfo,
        connectionString: connectionInfo.connectionString,
        type: addon?.type,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons/:id/refresh
   * Refresh addon status from Helm
   */
  async function refresh(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const result = await service.refreshStatus(id);

      res.json({
        message: "Status refreshed.",
        ...result,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons/:id/start
   * Start a stopped addon
   */
  async function start(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await service.start(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons/:id/stop
   * Stop a running addon
   */
  async function stop(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await service.stop(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons/:id/restart
   * Restart an addon
   */
  async function restart(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await service.restart(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /addons/:id/logs
   * Get pod logs for the addon
   */
  async function getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const tailLines = req.query.tailLines ? Number(req.query.tailLines) : 100;
      const sinceSeconds = req.query.sinceSeconds
        ? Number(req.query.sinceSeconds)
        : undefined;

      const result = await service.getLogs(id, { tailLines, sinceSeconds });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /addons/:id/events
   * Get Kubernetes events for the addon
   */
  async function getEvents(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const result = await service.getEvents(id);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /addons/:id/scale
   * Scale addon replicas
   */
  async function scale(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { replicas } = req.body;

      if (typeof replicas !== "number") {
        next(new BadRequestError("replicas must be a number"));
        return;
      }

      const result = await service.scale(id, replicas);
      res.json(result);
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    getCatalog,
    create,
    getById,
    update,
    remove,
    getConnection,
    refresh,
    start,
    stop,
    restart,
    getLogs,
    getEvents,
  };
}
