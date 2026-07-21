import { Request, Response, NextFunction } from "express";
import { useAppRepo } from "./app.repository";
import { useAppService } from "./app.service";
import { schemaAppCreate, schemaAppUpdate, schemaAppDeploy, schemaAppScale, TAppStatus, TApp } from "./app.model";
import { BadRequestError, NotFoundError } from "../../utils";

export function useAppController() {
  const repo = useAppRepo();
  const appService = useAppService();

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const body = { ...req.body };

      const { error, value } = schemaAppCreate.validate(body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const id = await repo.add(value);

      const domain = value.k8s?.domain ?? value.proxy?.host;
      res.status(201).json({
        message: "App created",
        appId: id,
        url: domain
          ? `${value.proxy?.ssl !== false ? "https" : "http"}://${domain}`
          : null,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      // Mask registry password in response
      const safeApp = {
        ...app,
        registry: app.registry
          ? { ...app.registry, password: "****" }
          : undefined,
      };

      // Optionally include K8s deployment status
      let deploymentStatus = null;
      if (req.query.includeStatus === "true") {
        try {
          deploymentStatus = await appService.getDeploymentStatus(id);
        } catch {
          // Ignore errors getting deployment status
        }
      }

      res.json({ app: safeApp, deploymentStatus });
    } catch (error) {
      next(error);
    }
  }

  async function getAll(req: Request, res: Response, next: NextFunction) {
    try {
      const { search, page, limit, status } = req.query;

      const data = await repo.getAll({
        search: search as string,
        page: page ? Number(page) : 1,
        limit: limit ? Number(limit) : 10,
        status: status as TAppStatus | undefined,
      });

      // Mask registry passwords
      const safeItems = data.items.map((app: TApp) => ({
        ...app,
        registry: app.registry
          ? { ...app.registry, password: "****" }
          : undefined,
      }));

      res.json({ ...data, items: safeItems });
    } catch (error) {
      next(error);
    }
  }

  async function updateById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppUpdate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      await repo.updateById(id, value);
      res.json({ message: "App updated" });
    } catch (error) {
      next(error);
    }
  }

  async function deleteById(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      // Delete app and all K8s resources
      const result = await appService.deleteApp(id);

      res.json({
        message: result.message,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Deployment
  // ---------------------------------------------------------------------------

  async function deploy(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppDeploy.validate(req.body || {});
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "deploying") {
        next(new BadRequestError("Deployment already in progress"));
        return;
      }

      const result = await appService.deploy(id, { version: value.version });

      res.json({
        message: result.message,
        appId: id,
        version: value.version,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  async function redeploy(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "deploying") {
        next(new BadRequestError("Deployment already in progress"));
        return;
      }

      // Redeploy is just a deploy with the current version
      const result = await appService.deploy(id, { version: app.currentVersion });

      res.json({
        message: result.message,
        appId: id,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  async function rollback(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const version = req.params.version || req.body?.version;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (!version) {
        next(new BadRequestError("Version is required for rollback"));
        return;
      }

      // For rollback, we need to update the image to the specified version and redeploy
      // This assumes the image tag matches the version
      const k8sConfig = app.k8s;
      if (!k8sConfig?.image) {
        next(new BadRequestError("App has no image configured"));
        return;
      }

      // Update image tag to rollback version
      const baseImage = k8sConfig.image.split(":")[0];
      const rollbackImage = `${baseImage}:${version}`;

      await repo.updateById(id, {
        k8s: {
          ...k8sConfig,
          image: rollbackImage,
        },
      });

      const result = await appService.deploy(id, { version });

      res.json({
        message: `Rolled back to version ${version}`,
        appId: id,
        version,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async function stop(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "stopped") {
        next(new BadRequestError("App is already stopped"));
        return;
      }

      const result = await appService.stop(id);

      res.json({
        message: result.message,
        appId: id,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  async function start(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status === "running") {
        next(new BadRequestError("App is already running"));
        return;
      }

      const result = await appService.start(id);

      res.json({
        message: result.message,
        appId: id,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  async function restart(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      if (app.status !== "running") {
        next(new BadRequestError("App must be running to restart"));
        return;
      }

      const result = await appService.restart(id);

      res.json({
        message: result.message,
        appId: id,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  async function scale(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { error, value } = schemaAppScale.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await appService.scale(id, value.replicas);

      res.json({
        message: result.message,
        appId: id,
        replicas: value.replicas,
        errors: result.errors.length > 0 ? result.errors : undefined,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Inspection
  // ---------------------------------------------------------------------------

  async function getLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const tailLines = req.query.lines ? Number(req.query.lines) : 100;
      const podName = req.query.pod as string | undefined;
      const container = req.query.container as string | undefined;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const results = await appService.getLogs(id, { tailLines, podName, container });

      res.json({
        appId: id,
        logs: results,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getVersion(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      res.json({
        version: app.currentVersion || "unknown",
        image: app.currentImage || app.k8s?.image || "unknown",
      });
    } catch (error) {
      next(error);
    }
  }

  async function getStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);

      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const deploymentStatus = await appService.getDeploymentStatus(id);

      res.json({
        appId: id,
        name: app.name,
        status: app.status,
        deployment: deploymentStatus,
      });
    } catch (error) {
      next(error);
    }
  }

  // ---------------------------------------------------------------------------
  // Execution
  // ---------------------------------------------------------------------------

  async function appExec(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const { command } = req.body as { command?: string };

      if (!command) {
        next(new BadRequestError("command is required"));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      // TODO: Implement kubectl exec via Kubernetes client
      // This requires WebSocket support for interactive exec
      res.status(501).json({
        message: "Exec is not yet implemented - requires WebSocket support",
        appId: id,
        command,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getDeployments(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const limit = req.query.limit ? Math.min(Number(req.query.limit), 50) : 10;
      const { useDeploymentRepo } = await import("../deployment");
      const deploymentRepo = useDeploymentRepo();
      const deployments = await deploymentRepo.getByAppId(id, { page: 1, limit });

      res.json({ deployments: deployments.items });
    } catch (error) {
      next(error);
    }
  }

  async function getLatestDeployment(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const { useDeploymentRepo } = await import("../deployment");
      const deploymentRepo = useDeploymentRepo();
      const deployment = await deploymentRepo.getLatestByAppId(id);

      if (!deployment) {
        res.json({
          deploymentId: null,
          status: "none",
          message: "No deployments found",
        });
        return;
      }

      // Calculate duration if completed
      let duration: number | undefined;
      if (deployment.startedAt && deployment.completedAt) {
        duration = new Date(deployment.completedAt).getTime() - new Date(deployment.startedAt).getTime();
      }

      res.json({
        deploymentId: deployment._id?.toString(),
        status: deployment.status,
        startedAt: deployment.startedAt,
        completedAt: deployment.completedAt,
        version: deployment.version || deployment.image,
        environment: deployment.environment,
        logs: deployment.logs,
        duration,
        url: deployment.url,
      });
    } catch (error) {
      next(error);
    }
  }

  async function getDeploymentStatus(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const deploymentId = req.params.deploymentId as string;
      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const { useDeploymentRepo } = await import("../deployment");
      const deploymentRepo = useDeploymentRepo();
      const deployment = await deploymentRepo.getById(deploymentId);

      if (!deployment) {
        next(new NotFoundError("Deployment not found"));
        return;
      }

      // Calculate duration if completed
      let duration: number | undefined;
      if (deployment.startedAt && deployment.completedAt) {
        duration = new Date(deployment.completedAt).getTime() - new Date(deployment.startedAt).getTime();
      }

      res.json({
        deploymentId: deployment._id?.toString(),
        status: deployment.status,
        startedAt: deployment.startedAt,
        completedAt: deployment.completedAt,
        version: deployment.version || deployment.image,
        environment: deployment.environment,
        logs: deployment.logs,
        duration,
        url: deployment.url,
      });
    } catch (error) {
      next(error);
    }
  }

  return {
    add,
    getById,
    getAll,
    updateById,
    deleteById,
    deploy,
    redeploy,
    rollback,
    stop,
    start,
    restart,
    scale,
    getLogs,
    getVersion,
    getStatus,
    appExec,
    getDeployments,
    getLatestDeployment,
    getDeploymentStatus,
  };
}
