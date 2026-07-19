import { Request, Response, NextFunction } from "express";
import { useAppRepo } from "./app.repository";
import { useServerRepo } from "../server/server.repository";
import { useKamalExecutor } from "../../services/kamal.executor";
import { schemaAppCreate, schemaAppUpdate, schemaAppDeploy } from "./app.model";
import { BadRequestError, NotFoundError } from "../../utils";

export function useAppController() {
  const repo = useAppRepo();
  const serverRepo = useServerRepo();
  const kamal = useKamalExecutor();

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async function add(req: Request, res: Response, next: NextFunction) {
    try {
      const { error, value } = schemaAppCreate.validate(req.body);
      if (error) {
        next(new BadRequestError(error.message));
        return;
      }

      // Validate servers exist and are online
      for (const serverId of value.serverIds) {
        const server = await serverRepo.getById(serverId);
        if (!server) {
          next(new NotFoundError(`Server not found: ${serverId}`));
          return;
        }
      }

      const id = await repo.add(value);
      res.status(201).json({ message: "App created", appId: id });
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

      res.json({ app: safeApp });
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
        status: status as any,
      });

      // Mask registry passwords
      const safeItems = data.items.map((app: any) => ({
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

      // Stop the app if running
      if (app.status === "running") {
        await kamal.stop(id).catch(() => {});
      }

      await repo.deleteById(id);
      res.json({ message: "App deleted" });
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

      const userId = req.cookies?.user;

      // Start deployment in background
      kamal
        .deploy({
          appId: id,
          version: value.version,
          force: value.force,
          triggeredBy: userId,
          onLog: (line) => {
            console.log(`[Deploy ${app.name}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Deployment failed for ${app.name}:`, err);
        });

      res.status(202).json({
        message: "Deployment started",
        status: "deploying",
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

      const userId = req.cookies?.user;

      kamal
        .redeploy({
          appId: id,
          triggeredBy: userId,
          onLog: (line) => {
            console.log(`[Redeploy ${app.name}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Redeployment failed for ${app.name}:`, err);
        });

      res.status(202).json({
        message: "Redeployment started",
        status: "deploying",
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

      const userId = req.cookies?.user;

      kamal
        .rollback({
          appId: id,
          version,
          triggeredBy: userId,
          onLog: (line) => {
            console.log(`[Rollback ${app.name}] ${line}`);
          },
        })
        .catch((err) => {
          console.error(`Rollback failed for ${app.name}:`, err);
        });

      res.status(202).json({
        message: "Rollback started",
        version: version || "previous",
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

      const result = await kamal.stop(id);
      
      res.json({
        message: result.success ? "App stopped" : "Failed to stop app",
        success: result.success,
        error: result.success ? undefined : result.stderr,
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

      const result = await kamal.start(id);
      
      res.json({
        message: result.success ? "App started" : "Failed to start app",
        success: result.success,
        error: result.success ? undefined : result.stderr,
      });
    } catch (error) {
      next(error);
    }
  }

  async function restart(req: Request, res: Response, next: NextFunction) {
    try {
      const id = req.params.id as string;
      const userId = req.cookies?.user;

      // Redeploy is effectively a restart in Kamal
      kamal
        .redeploy({
          appId: id,
          triggeredBy: userId,
        })
        .catch(() => {});

      res.status(202).json({ message: "Restart initiated" });
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
      const lines = req.query.lines ? Number(req.query.lines) : 100;

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.getLogs(id, lines);
      res.json(result);
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

      const version = await kamal.getVersion(id);
      res.json({ version });
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
      const { command } = req.body;

      if (!command) {
        next(new BadRequestError("command is required"));
        return;
      }

      const app = await repo.getById(id);
      if (!app) {
        next(new NotFoundError("App not found"));
        return;
      }

      const result = await kamal.appExec(id, command);
      res.json({
        success: result.success,
        output: result.stdout,
        error: result.stderr,
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
    getLogs,
    getVersion,
    appExec,
  };
}
