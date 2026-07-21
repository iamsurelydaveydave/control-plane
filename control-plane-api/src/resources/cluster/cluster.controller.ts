import { Request, Response, NextFunction } from "express";
import { useClusterRepo } from "./cluster.repository";
import { useClusterService } from "./cluster.service";
import { schemaClusterCreate, schemaClusterUpdate } from "./cluster.model";
import { BadRequestError } from "../../utils/error";

export function useClusterController() {
  const repo = useClusterRepo();
  const service = useClusterService();

  /**
   * GET /clusters - List all clusters
   */
  async function list(req: Request, res: Response, next: NextFunction) {
    try {
      const clusters = await service.getAll();
      res.json({ clusters });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /clusters/:id - Get cluster by ID
   */
  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const cluster = await service.getById(id);
      res.json({ cluster });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /clusters - Create a new cluster (remote only)
   */
  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaClusterCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Only remote clusters can be added via API
      // Local cluster is auto-initialized on setup
      if (value.type === "local") {
        next(new BadRequestError("Cannot create a local cluster via API. Use setup."));
        return;
      }

      const cluster = await service.addRemoteCluster(
        value.name,
        value.kubeconfig,
        value.context
      );

      res.status(201).json({
        message: "Cluster added.",
        cluster,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /clusters/:id - Update cluster
   */
  async function update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaClusterUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      const cluster = await repo.getById(id);

      res.json({
        message: "Cluster updated.",
        cluster,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /clusters/:id - Delete cluster
   */
  async function remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.deleteCluster(id);
      res.json({ message: "Cluster deleted." });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /clusters/:id/sync - Sync cluster status from K8s
   */
  async function sync(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      await service.syncClusterStatus(id);
      const cluster = await repo.getById(id);

      res.json({
        message: "Cluster synced.",
        cluster,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /clusters/:id/refresh-token - Refresh cluster join token
   */
  async function refreshToken(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const cluster = await service.refreshJoinToken(id);

      res.json({
        message: "Join token refreshed.",
        cluster,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /clusters/:id/join-token - Get join token for adding worker nodes
   */
  async function getJoinToken(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const cluster = await repo.getById(id);

      if (!cluster.joinToken) {
        next(new BadRequestError("Join token not available. Refresh token or check k3s configuration."));
        return;
      }

      // For security, only return the join command info, not raw token
      res.json({
        joinToken: cluster.joinToken,
        apiServerUrl: cluster.apiServerUrl || null,
        joinCommand: cluster.apiServerUrl
          ? `curl -sfL https://get.k3s.io | K3S_URL=${cluster.apiServerUrl} K3S_TOKEN=${cluster.joinToken} sh -s - agent`
          : null,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    list,
    getById,
    add,
    update,
    remove,
    sync,
    refreshToken,
    getJoinToken,
  };
}
