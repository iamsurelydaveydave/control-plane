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

      // Build connection string examples based on addon type
      const addon = await repo.getById(id);
      const connectionStrings: Record<string, string> = {};

      if (addon) {
        switch (addon.type) {
          case "redis":
            connectionStrings.redis = connectionInfo.password
              ? `redis://:${connectionInfo.password}@${connectionInfo.host}:${connectionInfo.port}`
              : `redis://${connectionInfo.host}:${connectionInfo.port}`;
            break;

          case "postgresql":
            connectionStrings.postgresql = connectionInfo.password
              ? `postgresql://${connectionInfo.username}:${connectionInfo.password}@${connectionInfo.host}:${connectionInfo.port}/postgres`
              : `postgresql://${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}/postgres`;
            break;

          case "mysql":
            connectionStrings.mysql = connectionInfo.password
              ? `mysql://${connectionInfo.username}:${connectionInfo.password}@${connectionInfo.host}:${connectionInfo.port}`
              : `mysql://${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}`;
            break;

          case "rabbitmq":
            connectionStrings.amqp = connectionInfo.password
              ? `amqp://${connectionInfo.username}:${connectionInfo.password}@${connectionInfo.host}:${connectionInfo.port}`
              : `amqp://${connectionInfo.username}@${connectionInfo.host}:${connectionInfo.port}`;
            break;

          case "elasticsearch":
            connectionStrings.elasticsearch = `http://${connectionInfo.host}:${connectionInfo.port}`;
            break;
        }
      }

      res.json({
        connectionInfo,
        connectionStrings,
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

  return {
    list,
    getCatalog,
    create,
    getById,
    update,
    remove,
    getConnection,
    refresh,
  };
}
